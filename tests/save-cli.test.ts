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
    // 저장 경로를 보는 테스트다. 두 가지를 함께 격리해야 한다. Orca CLI에 닿으면
    // 이 장치에 무엇이 열려 있는지에 따라 결과가 달라지고, 패널 경로를 그대로 두면
    // 이 저장소가 곧 설치된 플러그인일 때(개발 중에는 흔하다) 테스트 픽스처가
    // 사용자의 패널을 덮어써 만들어 둔 Graph·Task가 사라진 것처럼 보인다.
    env: {
      ...process.env,
      ORCA_GRAPH_RUNTIME_DIR: runtimeDirectory,
      ORCA_GRAPH_SKIP_REBUILD: "1",
      ORCA_CLI_COMMAND: path.join(runtimeDirectory, "orca-is-not-available-in-tests"),
      ORCA_GRAPH_PANEL_PATH: path.join(runtimeDirectory, "panel.html"),
    },
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

describe("save CLI · 삭제", () => {
  it("removes a deleted Task from the local store and unlinks its Todo", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-delete-"));
    cleanup.push(() => rm(runtimeDirectory, { recursive: true, force: true }));
    await writeFile(path.join(runtimeDirectory, "store.json"), JSON.stringify({
      schemaVersion: 1, activeGraphId: "graph-remote", graphs: [graph(1)], domains: [], milestones: [],
      tasks: [task(1), { ...task(1), id: "task-keep", title: "남는 Task" }],
      todos: [{ id: "todo-a", title: "연결된 Todo", taskId: "task-remote", draft: "", promptRevisions: [], status: "open", priority: "medium", tags: [], notes: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      dispatchLog: [],
    }));
    await writeFile(path.join(runtimeDirectory, "data-source.json"), JSON.stringify({ schemaVersion: 1, mode: "local" }));

    const output = await runCli(runtimeDirectory, ["save", payload({ deletions: { tasks: ["task-remote"] } })]);
    expect(output).toContain("저장 완료 (local)");

    const saved = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    // 진짜로 사라져야 한다. 보관 상태로 남으면 목록에 계속 보인다.
    expect(saved.tasks.map((item: any) => item.id)).toEqual(["task-keep"]);
    // 없는 Task를 가리키는 Todo를 남기면 그 Todo는 열 수 없는 링크를 계속 들고 있다.
    expect(saved.todos[0].taskId).toBeUndefined();
    expect(saved.lastSaveMessage).toContain("tasks 삭제 1");
  });
});

describe("실행 결과 관측", () => {
  it("reads the result line the prompt asked for, and ignores the instruction that names it", async () => {
    const { parseResultLine } = await import("../lib/store.mjs");
    // 에이전트가 남긴 결과 줄
    expect(parseResultLine("⏺ RESULT: done")).toEqual({ status: "done" });
    expect(parseResultLine("RESULT: failed — 템플릿 값 누락"))
      .toEqual({ status: "failed", message: "템플릿 값 누락" });
    // 프롬프트 본문에도 같은 문자열이 있다. 그것을 결과로 세면 보내자마자 끝난 것이 된다.
    expect(parseResultLine("마지막 응답의 첫 줄을 `RESULT: done` 또는 `RESULT: failed — <사유>`로 시작하십시오.")).toBeNull();
    expect(parseResultLine("아직 작업 중입니다")).toBeNull();
    // 마지막 결과가 이긴다 — 재시도한 세션은 마지막 줄이 정본이다.
    expect(parseResultLine("RESULT: failed — 1차\n다시 시도합니다\nRESULT: done")).toEqual({ status: "done" });
  });
});

describe("노드별 진행 관측", () => {
  it("reads the node lines the graph prompt asked for, and ignores its own format example", async () => {
    const { parseNodeStates } = await import("../lib/store.mjs");
    expect(parseNodeStates("⏺ NODE node-design done 설계 정리함")).toEqual({
      "node-design": { status: "done", message: "설계 정리함" },
    });
    expect(parseNodeStates("NODE node-implement failed — 템플릿 값 누락")).toEqual({
      "node-implement": { status: "failed", message: "템플릿 값 누락" },
    });
    // 프롬프트가 형식을 설명하는 줄까지 세면, 보내자마자 노드가 끝난 것이 된다.
    expect(parseNodeStates("  NODE <노드 id> <done|failed|skipped> <한 줄 요약>")).toEqual({});
    // 같은 노드를 다시 보고하면 마지막이 이긴다 — 재시도한 노드가 그렇다.
    // 시작도 보고한다 — 지금 도는 노드를 캔버스가 표시할 수 있다.
    expect(parseNodeStates("NODE node-a running")).toEqual({ "node-a": { status: "running" } });
    expect(parseNodeStates("NODE node-a failed 1차\nNODE node-a done 2차")).toEqual({
      "node-a": { status: "done", message: "2차" },
    });
  });
});

describe("save CLI · 패널 스냅샷", () => {
  it("writes the snapshot only where it was pointed, and saves even when no panel was built", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-panel-"));
    cleanup.push(() => rm(runtimeDirectory, { recursive: true, force: true }));
    const panelPath = path.join(runtimeDirectory, "panel.html");

    // 아직 빌드하지 않았다. 스냅샷을 싣지 못했다고 저장까지 실패로 접으면 방금 한
    // 편집이 사라진 것처럼 보인다.
    const skipped = await runCli(runtimeDirectory, ["save", payload({ activeGraphId: "graph-orca-demo" })]);
    expect(skipped).toContain("저장 완료 (local)");
    expect(skipped).toContain("패널을 아직 빌드하지 않아");
    expect(JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8")).activeGraphId).toBe("graph-orca-demo");

    await writeFile(panelPath, '<!doctype html><script id="orca-graph-bootstrap" type="application/json">{"store":{},"targets":{}}</script>', "utf8");
    const written = await runCli(runtimeDirectory, ["save", payload({ graphs: [{ ...graph(1), name: "패널에 실린 이름" }] })]);
    expect(written).toContain("패널을 다시 열면 반영됩니다.");
    // 가리킨 파일에만 싣는다. 이 격리가 없으면 테스트가 설치된 플러그인의 패널을
    // 덮어써 사용자가 만들어 둔 Graph·Task가 패널에서 사라진다.
    expect(await readFile(panelPath, "utf8")).toContain("패널에 실린 이름");
  });
});
