import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((task) => task()));
});

function frame(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `OGX1:data-source-test:1:1:${encoded}:END`;
}

async function waitFor(child: ChildProcessWithoutNullStreams, output: () => string, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`bridge did not print '${expected}':\n${output()}`)), 5_000);
    const interval = setInterval(() => {
      if (!output().includes(expected)) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
    child.once("error", reject);
  });
}

async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${description}`)), 5_000);
    const interval = setInterval(() => {
      if (!predicate()) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
  });
}

function graph(version: number) {
  return {
    id: "graph-remote", name: "Remote", summary: "", status: "draft", version,
    pinned: false, processEnabled: false, routineEnabled: false, repeatMode: "none", defaults: {}, runGuards: {},
    nodes: [], edges: [], runs: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("bridge structured source boundary", () => {
  it("commits the active graph with CAS and refreshes the replaceable snapshot", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-source-bridge-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const requests: Array<{ method: string; url: string; body?: any }> = [];
    let canonicalVersion = 4;
    let canonicalTaskVersion = 2;
    const task = () => ({
      id: "task-remote", title: "Remote task", prompt: "Draft", draft: "Draft",
      promptRevisions: [], status: "backlog", priority: "medium", tags: [],
      version: canonicalTaskVersion, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    });
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      requests.push({ method: request.method ?? "", url: request.url ?? "", ...(body ? { body } : {}) });
      let payload: unknown;
      if (request.method === "POST" && request.url?.endsWith("/mutations")) {
        expect(body.expectedVersion).toBe(2);
        canonicalTaskVersion = 3;
        payload = { contractVersion: 1, kind: "task", item: task() };
      } else if (request.method === "POST") {
        expect(body.expectedVersion).toBe(4);
        canonicalVersion = 5;
        payload = { contractVersion: 1, graph: graph(canonicalVersion) };
      } else {
        payload = {
          contractVersion: 1,
          source: { id: "workspace", name: "Workspace" },
          capabilities: { graphCommit: true, domainMutation: true, milestoneMutation: true, taskMutation: true, todoMutation: true, promptMutation: true },
          store: { schemaVersion: 1, activeGraphId: "graph-remote", graphs: [graph(canonicalVersion)], domains: [], milestones: [], tasks: [task()], todos: [] },
          catalog: { tasks: [], todos: [] },
        };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
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
    const store = { schemaVersion: 1, activeGraphId: "graph-remote", bridgeTerminalId: "terminal", graphs: [portableGraph], domains: [], milestones: [], tasks: [task()], todos: [] };
    await Promise.all([
      writeFile(path.join(directory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", url: `http://127.0.0.1:${address.port}/` })),
      writeFile(path.join(directory, "source-cache.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", status: "ready", store, catalog: [] })),
      writeFile(path.join(directory, "store.json"), JSON.stringify(store)),
    ]);
    const child = spawn(process.execPath, [path.join(process.cwd(), "bridge/index.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, ORCA_GRAPH_RUNTIME_DIR: directory, ORCA_GRAPH_SKIP_REBUILD: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    cleanup.push(async () => {
      if (child.exitCode === null) child.kill();
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitFor(child, () => output, "bridge ready");
    child.stdin.write(frame({ type: "save", store }));
    await waitFor(child, () => output, "graph store saved");
    const cache = JSON.parse(await readFile(path.join(directory, "source-cache.json"), "utf8"));
    expect(cache.store.graphs[0].version).toBe(5);
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /orca-graph-source/v1/graphs/graph-remote/commit",
      "GET /orca-graph-source/v1/snapshot",
    ]);
    expect(requests[0]?.body.graph).toMatchObject({
      engineering: { editor: { groupBy: "domain", edgeWaypoints: { "edge-a": [{ x: 144, y: 96 }] } } },
      nodes: [{ engineering: { layoutPinned: true } }],
    });
    child.stdin.write(frame({
      type: "mutate-source", graphId: "graph-remote",
      mutation: { kind: "task", expectedVersion: 2, relatedVersions: {}, item: task() },
    }));
    await waitFor(child, () => output, "data source task mutated");
    const mutatedCache = JSON.parse(await readFile(path.join(directory, "source-cache.json"), "utf8"));
    expect(mutatedCache.store.tasks[0].version).toBe(3);
    expect(requests.slice(2).map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST /orca-graph-source/v1/mutations",
      "GET /orca-graph-source/v1/snapshot",
    ]);
    child.stdin.end();
  });

  it("creates an ordered quick graph through the workspace API and refreshes that graph", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-quick-bridge-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const requests: Array<{ method: string; url: string; body?: any }> = [];
    const quickGraph = { ...graph(1), id: "GRAPH-quick", name: "검수 흐름" };
    const quickStore = {
      schemaVersion: 1, activeGraphId: "graph-remote", graphs: [graph(4), quickGraph],
      domains: [], milestones: [], tasks: [], todos: [],
    };
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      requests.push({ method: request.method ?? "", url: request.url ?? "", ...(body ? { body } : {}) });
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<script>window.__WORKSPACE_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"</script>');
        return;
      }
      if (request.method === "POST" && request.url?.endsWith("/graphs/quick")) {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ item: { id: "GRAPH-quick", version: 1 } }));
        return;
      }
      if (request.method === "GET" && request.url === "/orca-graph-source/v1/snapshot") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          contractVersion: 1, source: { id: "workspace", name: "Workspace" },
          capabilities: { graphCommit: true, taskMutation: true },
          store: quickStore, catalog: { tasks: [], todos: [] },
        }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "not found" }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initialStore = {
      schemaVersion: 1, activeGraphId: "graph-remote", graphs: [graph(4)],
      domains: [], milestones: [], tasks: [], todos: [],
    };
    await Promise.all([
      writeFile(path.join(directory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", url: `${baseUrl}/` })),
      writeFile(path.join(directory, "source-cache.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", status: "ready", store: initialStore, catalog: [] })),
      writeFile(path.join(directory, "store.json"), JSON.stringify(initialStore)),
    ]);
    const child = spawn(process.execPath, [path.join(process.cwd(), "bridge/index.mjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ORCA_GRAPH_RUNTIME_DIR: directory,
        ORCA_GRAPH_SKIP_REBUILD: "1",
        ORCA_GRAPH_WORKSPACE_BASE_URL: baseUrl,
        ORCA_GRAPH_WORKSPACE_ALLOW_INSECURE_LOOPBACK: "1",
        [["ORCA", "GRAPH", "WORK", "TASKS", "ENVIRONMENT"].join("_")]: "Workspace",
        ORCA_CLI_COMMAND: "/usr/bin/false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    cleanup.push(async () => { if (child.exitCode === null) child.kill(); });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitFor(child, () => output, "bridge ready");
    child.stdin.write(frame({
      type: "create-quick-graph", sourceTaskId: "TASK-source", expectedTaskVersion: 9,
      name: "검수 흐름", taskIds: ["TASK-source", "TASK-next"],
    }));
    await waitFor(child, () => output, "quick graph GRAPH-quick created");

    const request = requests.find((item) => item.method === "POST" && item.url.endsWith("/graphs/quick"));
    expect(request?.body).toEqual({
      source_task_id: "TASK-source", expected_task_version: 9,
      name: "검수 흐름", task_ids: ["TASK-source", "TASK-next"],
    });
    const cache = JSON.parse(await readFile(path.join(directory, "source-cache.json"), "utf8"));
    expect(cache.store.activeGraphId).toBe("GRAPH-quick");
    expect(cache.store.graphs.map((item: any) => item.id)).toContain("GRAPH-quick");
    child.stdin.end();
  });

  it("creates a Todo Task with CAS and returns its predefined Graph memberships", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-todo-task-bridge-"));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const requests: Array<{ method: string; url: string; body?: any }> = [];
    let bound = false;
    const worktreeGraph = { ...graph(6), id: "GRAPH-worktree", name: "워크트리 검수" };
    const snapshotStore = {
      schemaVersion: 1, activeGraphId: "GRAPH-worktree", graphs: [worktreeGraph], domains: [], milestones: [],
      tasks: [{
        id: "TASK-created", title: "원문 유지", prompt: "원문 유지\n둘째 줄", draft: "원문 유지\n둘째 줄",
        promptRevisions: [], status: "backlog", priority: "high", tags: [], version: 1,
        createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
      }],
      todos: [{
        id: "TODO-roundtrip", title: "원문 유지", notes: "1차 진행중", draft: "원문 유지\n둘째 줄",
        promptRevisions: [], status: "open", priority: "high", tags: [], taskId: "TASK-created", version: 8,
        createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z",
      }],
    };
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      requests.push({ method: request.method ?? "", url: request.url ?? "", ...(body ? { body } : {}) });
      let status = 200;
      let payload: unknown;
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<script>window.__WORKSPACE_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"</script>');
        return;
      }
      if (request.method === "GET" && request.url?.endsWith("/todos/TODO-roundtrip")) {
        payload = {
          item: {
            id: "TODO-roundtrip", content: "원문 유지\n둘째 줄", memo: "1차 진행중", due_on: null,
            priority: "high", status: "open", version: bound ? 8 : 7, archived_at: null,
          },
          task_binding: bound ? { id: "TASK-created" } : null,
        };
      } else if (request.method === "POST" && request.url?.endsWith("/todos/TODO-roundtrip/task")) {
        expect(body).toEqual({
          expected_todo_version: 7,
          idempotency_key: "todo-task-roundtrip",
          task: {
            title: "원문 유지\n둘째 줄", description: "1차 진행중", due_on: null, priority: "high",
            draft: "원문 유지\n둘째 줄",
          },
        });
        bound = true;
        status = 201;
        payload = { task: { id: "TASK-created" }, idempotent_replay: false };
      } else if (request.method === "GET" && request.url?.includes("/tasks?intake_method=all")) {
        payload = { items: [{
          id: "TASK-created", title: "원문 유지",
          graph_memberships: [{ id: "GRAPH-worktree", name: "워크트리 검수", status: "active" }],
        }] };
      } else if (request.method === "GET" && request.url === "/orca-graph-source/v1/snapshot") {
        payload = {
          contractVersion: 1, source: { id: "workspace", name: `${["under", "joy"].join("")}-workspace` },
          capabilities: { graphCommit: true, taskMutation: true, todoMutation: true },
          store: snapshotStore, catalog: { tasks: [], todos: [] },
        };
      } else {
        status = 404;
        payload = { detail: "not found" };
      }
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no port");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await Promise.all([
      writeFile(path.join(directory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", url: `${baseUrl}/` })),
      writeFile(path.join(directory, "source-cache.json"), JSON.stringify({ schemaVersion: 1, mode: "structured", status: "ready", store: snapshotStore, catalog: [] })),
      writeFile(path.join(directory, "store.json"), JSON.stringify(snapshotStore)),
    ]);
    const child = spawn(process.execPath, [path.join(process.cwd(), "bridge/index.mjs")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ORCA_GRAPH_RUNTIME_DIR: directory,
        ORCA_GRAPH_SKIP_REBUILD: "1",
        ORCA_GRAPH_WORKSPACE_BASE_URL: baseUrl,
        ORCA_GRAPH_WORKSPACE_ALLOW_INSECURE_LOOPBACK: "1",
        [["ORCA", "GRAPH", "WORK", "TASKS", "ENVIRONMENT"].join("_")]: "Workspace",
        ORCA_CLI_COMMAND: "/usr/bin/false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    cleanup.push(async () => { if (child.exitCode === null) child.kill(); });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitFor(child, () => output, "bridge ready");

    child.stdin.write(frame({ type: "create-todo-task", todoId: "TODO-roundtrip", idempotencyKey: "todo-task-roundtrip" }));
    await waitUntil(() => requests.some((item) => item.method === "POST" && item.url.endsWith("/todos/TODO-roundtrip/task")), "Todo Task creation");
    await waitUntil(() => requests.some((item) => item.url === "/orca-graph-source/v1/snapshot"), "post-create source refresh");

    child.stdin.write(frame({ type: "todo-graph-choices", todoId: "TODO-roundtrip" }));
    await waitUntil(() => requests.some((item) => item.url.includes("/tasks?intake_method=all")), "Task Graph membership lookup");
    expect(requests.filter((item) => item.url.endsWith("/todos/TODO-roundtrip")).length).toBeGreaterThanOrEqual(2);
    expect(requests.some((item) => item.url.includes("include_archived=true&limit=500"))).toBe(true);
    child.stdin.end();
  });
});

describe("bridge folder source boundary", () => {
  it("seeds a folder source, saves the full store, and reloads external changes", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-folder-runtime-"));
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-folder-data-"));
    cleanup.push(() => rm(runtimeDirectory, { recursive: true, force: true }));
    cleanup.push(() => rm(sourceDirectory, { recursive: true, force: true }));
    await mkdir(path.join(sourceDirectory, ".git"));
    const store = {
      schemaVersion: 1,
      activeGraphId: "graph-remote",
      bridgeTerminalId: "terminal",
      graphs: [graph(1)],
      domains: [], milestones: [], tasks: [], todos: [],
    };
    await writeFile(path.join(runtimeDirectory, "store.json"), JSON.stringify(store));
    const child = spawn(process.execPath, [path.join(process.cwd(), "bridge/index.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, ORCA_GRAPH_RUNTIME_DIR: runtimeDirectory, ORCA_GRAPH_SKIP_REBUILD: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    cleanup.push(async () => { if (child.exitCode === null) child.kill(); });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    await waitFor(child, () => output, "bridge ready");

    child.stdin.write(frame({
      type: "configure-source",
      config: { schemaVersion: 1, mode: "folder", folderPath: sourceDirectory },
      store,
    }));
    await waitFor(child, () => output, "data source configured (folder)");
    const externalPath = path.join(sourceDirectory, ".orca-graph-engineering", "store.json");
    const initialized = JSON.parse(await readFile(externalPath, "utf8"));
    expect(initialized.bridgeTerminalId).toBeUndefined();
    expect(initialized.graphs[0].name).toBe("Remote");

    const savedStore = { ...store, graphs: [{ ...store.graphs[0], name: "Saved in folder", version: 2 }] };
    child.stdin.write(frame({ type: "save", store: savedStore }));
    await waitFor(child, () => output, "graph store saved");
    expect(JSON.parse(await readFile(externalPath, "utf8")).graphs[0].name).toBe("Saved in folder");

    const external = JSON.parse(await readFile(externalPath, "utf8"));
    external.graphs[0].name = "Changed outside Orca";
    await writeFile(externalPath, `${JSON.stringify(external, null, 2)}\n`);
    child.stdin.write(frame({ type: "refresh-source", graphId: "graph-remote" }));
    await waitFor(child, () => output, "data source refreshed (folder)");
    const cache = JSON.parse(await readFile(path.join(runtimeDirectory, "source-cache.json"), "utf8"));
    expect(cache.store.graphs[0].name).toBe("Changed outside Orca");
    expect(cache.source.name).toContain("· Git");
    child.stdin.end();
  });
});
