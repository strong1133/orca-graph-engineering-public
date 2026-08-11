import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

/*
 * 저장 CLI는 패널의 유일한 쓰기 경로다. 패널 iframe에는 네트워크도 파일도 없으므로
 * 여기가 깨지면 사용자는 편집한 것을 남길 방법이 없다. 상주 프로세스가 아니라
 * 호출당 한 번 도는 프로세스이므로, 실제로 실행해서 경계를 확인한다.
 */

const execFileAsync = promisify(execFile);
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((task) => task()));
});

function payload(value: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 }).toString("base64url");
}

async function runCli(runtimeDirectory: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    path.join(process.cwd(), "scripts/graph-store.mjs"),
    ...args,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ORCA_GRAPH_RUNTIME_DIR: runtimeDirectory, ORCA_GRAPH_SKIP_REBUILD: "1" },
    timeout: 20_000,
  });
  return `${stdout}${stderr}`;
}

function graph(version: number) {
  return {
    id: "graph-remote", name: "Remote", summary: "", status: "draft", version,
    pinned: false, processEnabled: false, routineEnabled: false, repeatMode: "none", defaults: {}, runGuards: {},
    nodes: [], edges: [], runs: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

function task(version: number) {
  return {
    id: "task-remote", title: "Remote task", prompt: "Draft", draft: "Draft",
    promptRevisions: [], status: "backlog", priority: "medium", tags: [],
    version, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("save CLI · structured source", () => {
  it("commits each changed item with its own CAS version and re-reads the source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-save-cli-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const requests: Array<{ method: string; url: string; body?: any }> = [];
    let canonicalVersion = 4;
    let canonicalTaskVersion = 2;

    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      requests.push({ method: request.method ?? "", url: request.url ?? "", ...(body ? { body } : {}) });
      let result: unknown;
      if (request.method === "POST" && request.url?.endsWith("/mutations")) {
        canonicalTaskVersion = body.expectedVersion + 1;
        result = { contractVersion: 1, kind: "task", item: task(canonicalTaskVersion) };
      } else if (request.method === "POST") {
        canonicalVersion = body.expectedVersion + 1;
        result = { contractVersion: 1, graph: graph(canonicalVersion) };
      } else {
        result = {
          contractVersion: 1,
          source: { id: "workspace", name: "Workspace" },
          capabilities: { graphCommit: true, taskMutation: true },
          store: {
            schemaVersion: 1, activeGraphId: "graph-remote",
            graphs: [graph(canonicalVersion)], domains: [], milestones: [],
            tasks: [task(canonicalTaskVersion)], todos: [],
          },
          catalog: { tasks: [], todos: [] },
        };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");

    const portableGraph: any = graph(4);
    portableGraph.engineering = { editor: { groupBy: "domain", edgeWaypoints: { "edge-a": [{ x: 144, y: 96 }] } } };
    portableGraph.nodes = [{
      id: "node-a", kind: "task", label: "Pinned", x: 40, y: 40, status: "pending", joinMode: "all",
      task: { id: "task-remote", title: "Remote task", prompt: "Draft", version: 2 },
      engineering: { layoutPinned: true },
    }];
    const store = {
      schemaVersion: 1, activeGraphId: "graph-remote", saveTerminalId: "terminal",
      graphs: [graph(4)], domains: [], milestones: [], tasks: [task(2)], todos: [], dispatchLog: [],
    };
    await Promise.all([
      writeFile(path.join(directory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", url: `http://127.0.0.1:${address.port}/` })),
      writeFile(path.join(directory, "source-cache.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", status: "ready", store, catalog: [] })),
      writeFile(path.join(directory, "store.json"), JSON.stringify(store)),
    ]);

    const output = await runCli(directory, ["save", payload({
      graphs: [portableGraph],
      tasks: [task(2)],
      activeGraphId: "graph-remote",
    })]);
    expect(output).toContain("저장 완료 (structured)");

    // 그래프는 aggregate 커밋, 업무 항목은 항목별 mutation. 그 다음 원천을 다시 읽는다.
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /orca-graph-source/v1/graphs/graph-remote/commit",
      "POST /orca-graph-source/v1/mutations",
      "GET /orca-graph-source/v1/snapshot",
    ]);
    expect(requests[0]?.body.expectedVersion).toBe(4);
    expect(requests[1]?.body.expectedVersion).toBe(2);
    expect(requests[1]?.body.kind).toBe("task");

    // 편집 전용 메타데이터도 원천으로 왕복해야 배치가 사라지지 않는다.
    expect(requests[0]?.body.graph).toMatchObject({
      engineering: { editor: { groupBy: "domain", edgeWaypoints: { "edge-a": [{ x: 144, y: 96 }] } } },
      nodes: [{ engineering: { layoutPinned: true } }],
    });

    const cache = JSON.parse(await readFile(path.join(directory, "source-cache.json"), "utf8"));
    expect(cache.store.graphs[0].version).toBe(5);
    expect(cache.store.tasks[0].version).toBe(3);
  });

  it("does not touch the source when the payload carries no changes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-save-cli-empty-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    let calls = 0;
    const server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        contractVersion: 1, source: { id: "w", name: "W" }, capabilities: {},
        store: { schemaVersion: 1, activeGraphId: "graph-remote", graphs: [graph(1)], domains: [], milestones: [], tasks: [], todos: [] },
        catalog: { tasks: [], todos: [] },
      }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    await writeFile(path.join(directory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", url: `http://127.0.0.1:${address.port}/` }));

    await runCli(directory, ["save", payload({ activeGraphId: "graph-remote" })]);
    // 쓰기는 없고 스냅샷 재조회만 일어난다.
    expect(calls).toBe(1);
  });
});

describe("save CLI · folder source", () => {
  it("seeds a folder source, saves changed items, and reloads external edits", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-folder-runtime-"));
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-folder-data-"));
    cleanup.push(() => rm(runtimeDirectory, { recursive: true, force: true }));
    cleanup.push(() => rm(sourceDirectory, { recursive: true, force: true }));
    await mkdir(path.join(sourceDirectory, ".git"));
    const store = {
      schemaVersion: 1, activeGraphId: "graph-remote", saveTerminalId: "terminal",
      graphs: [graph(1)], domains: [], milestones: [], tasks: [], todos: [], dispatchLog: [],
    };
    await writeFile(path.join(runtimeDirectory, "store.json"), JSON.stringify(store));

    const configured = await runCli(runtimeDirectory, ["source", payload({
      schemaVersion: 1, mode: "folder", folderPath: sourceDirectory,
    })]);
    expect(configured).toContain("데이터 원천 설정 완료 (folder");

    const externalPath = path.join(sourceDirectory, ".orca-graph-engineering", "store.json");
    const initialized = JSON.parse(await readFile(externalPath, "utf8"));
    // 이 장치에서만 의미 있는 값은 이식 가능한 파일에 나가지 않는다.
    expect(initialized.saveTerminalId).toBeUndefined();
    expect(initialized.graphs[0].name).toBe("Remote");

    await runCli(runtimeDirectory, ["save", payload({
      graphs: [{ ...graph(1), name: "Saved in folder", version: 2 }],
      activeGraphId: "graph-remote",
    })]);
    expect(JSON.parse(await readFile(externalPath, "utf8")).graphs[0].name).toBe("Saved in folder");

    const external = JSON.parse(await readFile(externalPath, "utf8"));
    external.graphs[0].name = "Changed outside Orca";
    await writeFile(externalPath, `${JSON.stringify(external, null, 2)}\n`);
    await runCli(runtimeDirectory, ["refresh"]);
    const cache = JSON.parse(await readFile(path.join(runtimeDirectory, "source-cache.json"), "utf8"));
    expect(cache.store.graphs[0].name).toBe("Changed outside Orca");
    expect(cache.source.name).toContain("· Git");
  });

  it("merges a changed item instead of replacing the whole local store", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-merge-"));
    cleanup.push(() => rm(runtimeDirectory, { recursive: true, force: true }));
    await writeFile(path.join(runtimeDirectory, "store.json"), JSON.stringify({
      schemaVersion: 1, activeGraphId: "graph-remote",
      graphs: [graph(1), { ...graph(1), id: "graph-other", name: "Other" }],
      domains: [], milestones: [], tasks: [task(1)], todos: [], dispatchLog: [],
    }));
    await writeFile(path.join(runtimeDirectory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "local" }));

    await runCli(runtimeDirectory, ["save", payload({
      graphs: [{ ...graph(1), name: "Renamed", version: 2 }],
    })]);

    const saved = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    // 보내지 않은 그래프와 Task가 저장 때문에 사라지면 다른 화면의 편집이 증발한다.
    expect(saved.graphs.map((item: any) => `${item.id}:${item.name}`)).toEqual([
      "graph-remote:Renamed", "graph-other:Other",
    ]);
    expect(saved.tasks).toHaveLength(1);
    expect(saved.lastSaveMessage).toContain("그래프 1");
  });
});
