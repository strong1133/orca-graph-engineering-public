import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The runtime bridge deliberately stays dependency-free JavaScript so an
// extracted plugin can run without installing packages.
// @ts-expect-error JavaScript runtime module has no declaration file.
import { commitFolderStore, commitStructuredGraph, commitStructuredMutation, folderSourceStorePath, initializeFolderDataSource, normalizeDataSourceConfig, projectUnstructuredJson, refreshDataSource, requestDataSource } from "../bridge/data-source.mjs";

const envKeys: string[] = [];
const cleanupDirectories: string[] = [];

afterEach(async () => {
  for (const key of envKeys.splice(0)) delete process.env[key];
  await Promise.all(cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("data source configuration", () => {
  it("stores only an environment variable name and rejects URL credentials", () => {
    expect(normalizeDataSourceConfig({
      schemaVersion: 1,
      mode: "structured",
      url: "https://example.test/api",
      authEnv: "GRAPH_SOURCE_TOKEN",
    })).toEqual({
      schemaVersion: 1,
      mode: "structured",
      url: "https://example.test/api",
      authEnv: "GRAPH_SOURCE_TOKEN",
    });
    expect(() => normalizeDataSourceConfig({
      schemaVersion: 1,
      mode: "structured",
      url: "https://secret@example.test/api",
    })).toThrow("credentials are not allowed");
    expect(() => normalizeDataSourceConfig({
      schemaVersion: 1,
      mode: "structured",
      url: "https://example.test/api",
      authEnv: "actual-token-value",
    })).toThrow("uppercase environment variable");
  });

  it("normalizes an absolute folder source without treating it as a remote URL", () => {
    const folderPath = path.join(tmpdir(), "personal-graph-data");
    expect(normalizeDataSourceConfig({ schemaVersion: 1, mode: "folder", folderPath, url: "https://ignored.test" })).toEqual({
      schemaVersion: 1,
      mode: "folder",
      folderPath,
    });
    expect(() => normalizeDataSourceConfig({ schemaVersion: 1, mode: "folder", folderPath: "relative/path" })).toThrow("must be absolute");
    expect(() => normalizeDataSourceConfig({ schemaVersion: 1, mode: "folder", folderPath: path.parse(folderPath).root })).toThrow("filesystem root");
  });
});

describe("folder and local Git storage", () => {
  it("initializes, refreshes, and atomically updates a portable GraphStore", async () => {
    const folderPath = await mkdtemp(path.join(tmpdir(), "orca-graph-folder-source-"));
    cleanupDirectories.push(folderPath);
    await mkdir(path.join(folderPath, ".git"));
    const config = { schemaVersion: 1 as const, mode: "folder" as const, folderPath };
    const store = {
      schemaVersion: 1,
      activeGraphId: "graph-folder",
      bridgeTerminalId: "local-terminal",
      graphs: [{ id: "graph-folder", name: "Folder graph", nodes: [], edges: [] }],
      domains: [], milestones: [], tasks: [{ id: "task-folder", title: "Folder task" }], todos: [],
    };

    await initializeFolderDataSource(config, store);
    const stored = JSON.parse(await readFile(folderSourceStorePath(config), "utf8"));
    expect(stored.bridgeTerminalId).toBeUndefined();
    expect(stored.graphs[0].name).toBe("Folder graph");

    const cache = await refreshDataSource(config);
    expect(cache).toMatchObject({ mode: "folder", status: "ready", message: "1 graphs · 1 tasks · 0 todos · Git storage" });
    expect(cache.source.name).toContain("· Git");
    expect(cache.capabilities).toMatchObject({ graphCommit: true, taskMutation: true, todoMutation: true });

    store.graphs[0]!.name = "Updated folder graph";
    await commitFolderStore(config, store);
    expect((await refreshDataSource(config)).store.graphs[0].name).toBe("Updated folder graph");
  });
});

describe("unstructured JSON catalog", () => {
  it("auto-discovers the largest record array", () => {
    const items = projectUnstructuredJson(
      { meta: { version: 3 }, payload: { entries: [{ code: "A", label: "Alpha", text: "Do alpha" }, { code: "B", label: "Beta" }] } },
      { schemaVersion: 1, mode: "unstructured", url: "https://example.test/data.json", idField: "code" },
    );
    expect(items.map((item: { id: string }) => item.id)).toEqual(["A", "B"]);
    expect(items[0]).toMatchObject({ kind: "record", title: "Alpha", body: "Do alpha" });
  });

  it("supports an explicit record path and field mapping", () => {
    const items = projectUnstructuredJson(
      { result: { rows: [{ ref: 9, headline: "Mapped", details: "Mapped body" }] } },
      {
        schemaVersion: 1,
        mode: "unstructured",
        url: "https://example.test/data.json",
        recordsPath: "result.rows",
        idField: "ref",
        titleField: "headline",
        bodyField: "details",
      },
    );
    expect(items[0]).toMatchObject({ id: "9", title: "Mapped", body: "Mapped body" });
  });
});

describe("structured workspace contract", () => {
  it("recovers the Orca session token from the configured origin after a bridge restart", async () => {
    const authEnv = "ORCA_GRAPH_SOURCE_TOKEN";
    envKeys.push(authEnv);
    delete process.env[authEnv];
    // bootstrap 은 토큰을 담은 전역 변수 이름을 설정한 배포에서만 시도한다.
    envKeys.push("ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR");
    process.env.ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR = "window.__WORKSPACE_SESSION_TOKEN__";
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const token = "session-token-from-origin-12345";
    const fetchImpl = async (url: URL, init: RequestInit) => {
      requests.push({ url: url.toString(), authorization: new Headers(init.headers).get("authorization") });
      if (url.pathname === "/") {
        return new Response(`<script>window.__WORKSPACE_SESSION_TOKEN__="${token}"</script>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await expect(requestDataSource(
      { schemaVersion: 1, mode: "structured", url: "https://workspace.example/api/plugins/workspace", authEnv },
      "snapshot",
      {},
      { fetchImpl },
    )).resolves.toEqual({ ok: true });
    expect(requests).toEqual([
      { url: "https://workspace.example/", authorization: null },
      { url: "https://workspace.example/api/plugins/workspace/snapshot", authorization: `Bearer ${token}` },
    ]);
    expect(process.env[authEnv]).toBe(token);
  });

  it("does not bootstrap arbitrary authentication environment variables", async () => {
    const authEnv = "PRIVATE_SOURCE_TOKEN";
    envKeys.push(authEnv);
    delete process.env[authEnv];
    let fetched = false;
    await expect(requestDataSource(
      { schemaVersion: 1, mode: "structured", url: "https://example.test/api", authEnv },
      "snapshot",
      {},
      { fetchImpl: async () => { fetched = true; return new Response("{}"); } },
    )).rejects.toThrow(`authentication environment variable is missing: ${authEnv}`);
    expect(fetched).toBe(false);
  });

  it("loads a versioned snapshot and sends graph CAS commits with bearer auth", async () => {
    const authEnv = "GRAPH_SOURCE_TEST_TOKEN";
    envKeys.push(authEnv);
    process.env[authEnv] = "test-token";
    const requests: Array<{ url: string; authorization: string | null; body?: unknown }> = [];
    const graph = {
      id: "graph-1", name: "Graph", summary: "", status: "draft", version: 4,
      pinned: false, processEnabled: false, routineEnabled: false, repeatMode: "none", defaults: {}, runGuards: {},
      nodes: [], edges: [], runs: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    const fetchImpl = async (url: URL, init: RequestInit) => {
      requests.push({
        url: url.toString(),
        authorization: new Headers(init.headers).get("authorization"),
        ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      const body = url.pathname.endsWith("/snapshot")
        ? {
          contractVersion: 1,
          source: { id: "workspace", name: "Workspace" },
          store: { schemaVersion: 1, activeGraphId: graph.id, graphs: [graph] },
          catalog: { tasks: [{ id: "task-1", kind: "task", title: "Task" }], todos: [] },
        }
        : { contractVersion: 1, graph: { ...graph, version: 5 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    const config = { schemaVersion: 1 as const, mode: "structured" as const, url: "https://example.test/api/", authEnv };
    const cache = await refreshDataSource(config, { fetchImpl });
    expect(cache).toMatchObject({ mode: "structured", status: "ready", message: "1 graphs · 1 tasks · 0 todos" });
    const committed = await commitStructuredGraph(config, graph, { fetchImpl });
    expect(committed.version).toBe(5);
    expect(requests[0]).toMatchObject({ url: "https://example.test/api/orca-graph-source/v1/snapshot", authorization: "Bearer test-token" });
    expect(requests[1]?.body).toMatchObject({ contractVersion: 1, expectedVersion: 4, graph: { id: "graph-1" } });
  });

  it("sends versioned work mutations without hiding 409 conflicts", async () => {
    const requests: Array<{ body: any }> = [];
    const fetchImpl = async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push({ body });
      return new Response(JSON.stringify({
        contractVersion: 1,
        kind: "todo",
        item: { ...body.item, version: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const item = {
      id: "todo-1", version: 7, title: "Canonical", notes: "", draft: "Human",
      promptRevisions: [], status: "open", priority: "medium", tags: [],
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    const committed = await commitStructuredMutation(
      { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
      { kind: "todo", expectedVersion: 7, relatedVersions: { "task-1": 3 }, item },
      { fetchImpl },
    );
    expect(committed.version).toBe(8);
    expect(requests[0]?.body).toMatchObject({
      contractVersion: 1, operation: "upsert", kind: "todo", expectedVersion: 7,
      relatedVersions: { "task-1": 3 }, item: { id: "todo-1", draft: "Human" },
    });

    const conflictFetch = async () => new Response(JSON.stringify({ detail: "Todo version conflict" }), {
      status: 409, headers: { "content-type": "application/json" },
    });
    await expect(commitStructuredMutation(
      { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
      { kind: "todo", expectedVersion: 7, item },
      { fetchImpl: conflictFetch },
    )).rejects.toMatchObject({ status: 409 });
  });
});
