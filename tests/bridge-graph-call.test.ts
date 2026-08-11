import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { graphFromValidationFixture, validationFixtureCases } from "./validation-fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function frame(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `OGX1:test-run:1:1:${encoded}:END`;
}

async function waitForOutput(child: ChildProcessWithoutNullStreams, output: () => string, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`bridge did not print '${expected}':\n${output()}`)), 5000);
    const poll = setInterval(() => {
      if (!output().includes(expected)) return;
      clearTimeout(deadline);
      clearInterval(poll);
      resolve();
    }, 10);
    child.once("error", reject);
  });
}

async function sendToBridge(
  runtimeDirectory: string,
  payload: unknown,
  expected: string,
  environment: Record<string, string> = {},
  trailingPayloads: unknown[] = [],
  // 뒤따르는 프레임을 이 표시가 나온 뒤에 보낸다. 같이 밀어 넣으면 두 요청이
  // 한 번에 큐에 들어가 "실행 중에 들어온 요청"을 재현하지 못한다.
  trailingAfter?: { marker: string; delayMs?: number },
): Promise<string> {
  const root = process.cwd();
  const child = spawn(process.execPath, [path.join(root, "bridge/index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ORCA_GRAPH_RUNTIME_DIR: runtimeDirectory,
      ORCA_GRAPH_SKIP_REBUILD: "1",
      ...environment,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitForOutput(child, () => output, "bridge ready");
    child.stdin.write(frame(payload));
    if (trailingAfter && trailingPayloads.length) {
      await waitForOutput(child, () => output, trailingAfter.marker);
      await new Promise((resolve) => setTimeout(resolve, trailingAfter.delayMs ?? 250));
    }
    for (const trailing of trailingPayloads) child.stdin.write(frame(trailing));
    await waitForOutput(child, () => output, expected);
    child.stdin.end();
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    return output;
  } finally {
    if (!child.killed && child.exitCode === null) child.kill();
  }
}

async function installFakeOrca(runtimeDirectory: string): Promise<{ command: string; callLog: string }> {
  const command = path.join(runtimeDirectory, "fake-orca.mjs");
  const callLog = path.join(runtimeDirectory, "orca-calls.jsonl");
  await writeFile(command, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = process.env.ORCA_GRAPH_FAKE_MODE || "idle-agent";
const remote = args.includes("--environment");
appendFileSync(process.env.ORCA_GRAPH_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
const fakeCallLog = readFileSync(process.env.ORCA_GRAPH_FAKE_CALL_LOG, "utf8");
const promptSendCount = fakeCallLog.split("\\n").filter((line) => line.includes('["terminal","send"')).length;
let result = {};
if (args[0] === "environment" && args[1] === "list") {
  result = { environments: process.env.ORCA_GRAPH_FAKE_REMOTE === "1" ? [{ id: "env-jsj2", name: "jsj2" }] : [] };
} else if (args[0] === "worktree" && args[1] === "ps") {
  const paneKey = mode === "stale" ? "new-tab:new-leaf" : "fake-tab:fake-leaf";
  const worktree = {
    worktreeId: remote ? "remote-worktree" : "fake-worktree",
    repoId: remote ? "remote-repo" : "fake-repo",
    path: remote ? "/portable/remote-project" : "/portable/fake-project",
    branch: "refs/heads/main",
    isArchived: false,
    isActive: true,
    isMainWorktree: true,
    liveTerminalCount: 1,
    agents: ["shell", "missing-identity"].includes(mode) ? [] : [{
      paneKey,
      state: mode === "busy" ? "working" : "done",
      agentType: "codex",
      lastAssistantMessage: promptSendCount
        ? process.env.ORCA_GRAPH_FAKE_ASSISTANT
          ? process.env.ORCA_GRAPH_FAKE_ASSISTANT + "\\nturn " + promptSendCount
          : JSON.stringify({ branch: "y", reason: "fake result selects y " + promptSendCount })
        : "fake agent ready",
    }],
  };
  const branchWorktree = {
    ...worktree,
    worktreeId: "fake-feature-worktree",
    path: "/portable/fake-project-feature",
    branch: "refs/heads/feature/review",
    isActive: false,
    isMainWorktree: false,
    liveTerminalCount: 0,
    agents: [],
  };
  const secondWorktree = {
    ...worktree,
    worktreeId: "second-worktree",
    repoId: "second-repo",
    path: "/portable/second-project",
    branch: "refs/heads/release",
    isActive: false,
    isMainWorktree: true,
    liveTerminalCount: 0,
    agents: [],
  };
  result = { worktrees: mode === "missing-worktree" ? [] : [worktree, ...(process.env.ORCA_GRAPH_FAKE_BRANCH === "1" && !remote ? [branchWorktree] : []), ...(process.env.ORCA_GRAPH_FAKE_SECOND_PROJECT === "1" && !remote ? [secondWorktree] : [])] };
} else if (args[0] === "project" && args[1] === "list") {
  result = { projects: [remote
    ? { id: "remote-project", displayName: "Remote project", sourceRepoIds: ["remote-repo"] }
    : { id: "fake-project", displayName: "Fake project", sourceRepoIds: ["fake-repo"] },
    ...(process.env.ORCA_GRAPH_FAKE_SECOND_PROJECT === "1" && !remote
      ? [{ id: "second-project", displayName: "Second project", sourceRepoIds: ["second-repo"] }]
      : [])] };
} else if (args[0] === "terminal" && args[1] === "list") {
  result = { terminals: [{
    handle: remote ? "remote-session" : "fake-session",
    worktreeId: remote ? "remote-worktree" : "fake-worktree",
    tabId: mode === "stale" ? "new-tab" : "fake-tab",
    leafId: mode === "stale" ? "new-leaf" : "fake-leaf",
    connected: true,
    writable: true,
  }] };
} else if (args[0] === "terminal" && args[1] === "wait") {
  const waitTrace = process.env.ORCA_GRAPH_FAKE_WAIT_TRACE;
  const waitDelay = Number(process.env.ORCA_GRAPH_FAKE_WAIT_DELAY_MS || 0);
  if (waitTrace) appendFileSync(waitTrace, "start\\n");
  if (waitDelay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitDelay);
  if (waitTrace) appendFileSync(waitTrace, "end\\n");
  result = { wait: { satisfied: !["busy", "idle-timeout"].includes(mode) } };
} else if (args[0] === "terminal" && args[1] === "create") {
  if (process.env.ORCA_GRAPH_FAKE_FAIL_SECOND === "1" && args.includes("id:second-worktree")) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: "second project launch failed" } }));
    process.exit(0);
  }
  const unavailableBudget = Number(process.env.ORCA_GRAPH_FAKE_CREATE_UNAVAILABLE || 0);
  const createCount = fakeCallLog.split("\\n").filter((line) => line.includes('["terminal","create"')).length;
  if (unavailableBudget > 0 && createCount <= unavailableBudget) {
    process.stdout.write(JSON.stringify({ ok: false, error: { code: "runtime_unavailable", message: "runtime_unavailable" } }));
    process.exit(0);
  }
  result = { terminal: { handle: remote ? "remote-session" : "fake-session" } };
} else if (args[0] === "terminal" && args[1] === "show") {
  result = { terminal: { handle: remote ? "remote-session" : "fake-session", worktreeId: remote ? "remote-worktree" : "fake-worktree", tabId: "fake-tab", leafId: "fake-leaf" } };
} else if (args[0] === "terminal" && args[1] === "send") {
  result = { terminal: { handle: remote ? "remote-session" : "fake-session" } };
} else if (args[0] === "status") {
  result = {
    app: { running: true, desktopWindowStatus: "available" },
    runtime: { state: "ready", reachable: true, runtimeId: "fake-runtime" },
    graph: { state: process.env.ORCA_GRAPH_FAKE_GRAPH_STATE || "ready" },
  };
}
process.stdout.write(JSON.stringify({ ok: true, result }));
`, { mode: 0o755 });
  await writeFile(path.join(runtimeDirectory, "targets.json"), `${JSON.stringify({
    refreshedAt: "2026-08-09T00:00:00.000Z",
    environments: [{ id: "local", name: "jsj1", local: true, connected: true }],
    projects: [{ id: "fake-project", name: "Fake project", environmentId: "local", worktreeId: "fake-worktree", path: "/portable/fake-project", branch: "refs/heads/main" }],
    branches: [{ id: "main", branch: "refs/heads/main", environmentId: "local", projectId: "fake-project", repoId: "fake-repo", worktreeId: "fake-worktree", path: "/portable/fake-project" }],
    sessions: [{
      id: "fake-session",
      title: "Fake session",
      environmentId: "local",
      worktreeId: "fake-worktree",
      projectId: "fake-project",
      paneKey: "fake-tab:fake-leaf",
      agentType: "codex",
      agentState: "done",
      writable: true,
      connected: true,
    }],
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", agent: "codex", reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"] },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", agent: "codex", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
      { id: "claude-opus-5", label: "Claude Opus 5", agent: "claude", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
    ],
  })}\n`, "utf8");
  return { command, callLog };
}

async function readCallLog(callLog: string): Promise<string> {
  try {
    return await readFile(callLog, "utf8");
  } catch {
    return "";
  }
}

function taskNode(id: string, routing: Record<string, string> = {}, engineering: Record<string, unknown> = {}) {
  return {
    id,
    kind: "task",
    label: id,
    x: 0,
    y: 0,
    status: "pending",
    joinMode: "all",
    task: { id: `task-${id}`, title: id, prompt: `execute ${id}` },
    routing,
    engineering,
  };
}

function executionGraph(
  id: string,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>> = [],
  defaults: Record<string, string> = { sessionId: "fake-session" },
) {
  const now = "2026-08-09T00:00:00.000Z";
  return {
    id,
    name: id,
    summary: "execution preflight fixture",
    status: "active",
    version: 1,
    pinned: false,
    processEnabled: false,
    routineEnabled: false,
    repeatMode: "none",
    defaults,
    runGuards: { claimLeaseSeconds: 60 },
    engineering: { traversalHopLimit: 8 },
    nodes,
    edges,
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function writeGraphStore(
  runtimeDirectory: string,
  graphs: Array<Record<string, unknown>>,
  tasks: Array<Record<string, unknown>> = [],
): Promise<void> {
  await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify({
    schemaVersion: 1,
    activeGraphId: graphs[0]?.id,
    tasks,
    graphs,
  })}\n`, "utf8");
}

const pureRouteFailures = [
  { id: "missing-session", routing: { sessionId: "missing-session" }, expected: "session unavailable: missing-session" },
  { id: "missing-project-worktree", routing: { projectId: "missing-project", model: "gpt-5.6-sol" }, expected: "project has no available worktree: missing-project" },
  { id: "disallowed-model", routing: { projectId: "fake-project", model: "not-allowed" }, expected: "model is not allowed: not-allowed" },
  { id: "agent-family-mismatch", routing: { sessionId: "fake-session", model: "claude-opus-5" }, expected: "session agent/model mismatch" },
  { id: "invalid-reasoning", routing: { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "warp" }, expected: "reasoning policy is not supported by gpt-5.6-sol: warp" },
] as const;

describe("bridge graph calls", () => {
  it("plans and executes one Task without creating a graph run", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-standalone",
      title: "단건 Task",
      prompt: "단건 실행 프롬프트",
      draft: "단건 실행 프롬프트",
      promptRevisions: [],
      status: "ready",
      priority: "medium",
      tags: [],
      projects: [{
        id: "standalone-target", role: "target", locatorKind: "folder", locator: "/portable/fake-project",
        label: "Fake project", branch: "main", position: 0,
      }],
      createdAt: now,
      updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const environment = { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog };

    await sendToBridge(
      runtimeDirectory,
      { type: "run-task", taskId: "TASK-standalone", routing: { model: "gpt-5.6-sol", reasoning: "high" }, dryRun: true },
      "task TASK-standalone planned",
      environment,
    );
    expect(await readCallLog(fake.callLog)).toBe("");

    await sendToBridge(
      runtimeDirectory,
      { type: "run-task", taskId: "TASK-standalone", routing: { model: "gpt-5.6-sol", reasoning: "high" }, dryRun: false },
      "task TASK-standalone executed",
      environment,
    );
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const create = calls.find((args) => args[0] === "terminal" && args[1] === "create");
    const send = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    expect(create).toEqual(expect.arrayContaining(["--worktree", "id:fake-worktree", "--title", "Task · 단건 Task"]));
    expect(create?.join(" ")).toContain("codex --model");
    expect(create?.filter((argument) => argument === "--model")).toHaveLength(0);
    expect(create?.[create.indexOf("--command") + 1]).toContain("codex --model 'gpt-5.6-sol'");
    expect(send?.join("\n")).toContain("Task: 단건 Task (TASK-standalone)");
    expect(send?.join("\n")).toContain("단건 실행 프롬프트");
    expect(send?.join("\n")).toContain("target · folder: /portable/fake-project · branch main");
    expect(send?.join("\n")).not.toContain("Graph:");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs.every((graph: { runs: unknown[] }) => graph.runs.length === 0)).toBe(true);
  });

  it("runs without an explicit project by using the current Orca worktree", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const now = "2026-08-10T00:00:00.000Z";
    await writeGraphStore(runtimeDirectory, [], [{
      id: "TASK-current-context", title: "현재 컨텍스트 실행", prompt: "현재 Orca 컨텍스트에서 실행", draft: "현재 Orca 컨텍스트에서 실행",
      promptRevisions: [], status: "ready", priority: "medium", tags: [], projects: [], createdAt: now, updatedAt: now,
    }]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "start-task-execution", taskId: "TASK-current-context", routing: { environmentId: "local", model: "gpt-5.6-sol" } },
      "execution completed",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.find((args) => args[0] === "terminal" && args[1] === "create"))
      .toEqual(expect.arrayContaining(["--worktree", "id:fake-worktree"]));
    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0]).toMatchObject({
      status: "completed",
      targets: [{ projectId: "fake-project", projectName: "Fake project", sessionId: "fake-session" }],
    });
  });

  it("starts a tracked Task asynchronously and persists commercial UI progress", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-tracked", title: "추적 Task", prompt: "실행 상태를 추적한다", draft: "실행 상태를 추적한다",
      promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [{ id: "tracked-target", role: "target", locatorKind: "folder", locator: "/portable/fake-project", label: "Fake project", branch: "main", position: 0 }],
      createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "start-task-execution", taskId: "TASK-tracked", routing: { environmentId: "local", sessionId: "fake-session", model: "gpt-5.6-sol" } },
      "execution completed",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      itemKind: "task", itemId: "TASK-tracked", title: "추적 Task", status: "completed",
      executionMode: "single_session", progress: { completed: 1, failed: 0, total: 1 },
      targets: [{ status: "completed", environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol", sessionId: "fake-session", sessionTitle: "Fake session" }],
    });
  });

  it("starts a tracked Graph asynchronously and records node progress and its Orca session", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-tracked",
      [taskNode("tracked-node", { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "high" })],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "high" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol", reasoning: "high" },
        startNewRun: true,
      },
      "execution completed",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      itemKind: "graph", itemId: "GRAPH-tracked", title: "GRAPH-tracked", status: "completed",
      executionMode: "single_session", progress: { completed: 1, failed: 0, total: 1 },
      targets: [{ status: "completed", environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol", sessionId: "fake-session" }],
    });
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs.at(-1)).toMatchObject({
      status: "done",
      nodeResults: [{ nodeId: "tracked-node", status: "done", sessionId: "fake-session" }],
    });
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const send = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    const prompt = send?.[send.indexOf("--text") + 1] ?? "";
    expect(prompt).toContain("bridge already claimed this node");
    expect(prompt).toContain("Do not claim, complete, reset, start, or change the status of this Graph run or node");
    expect(prompt).toContain("RESULT: failed");
  });

  it("repairs a false completed Graph execution from authoritative failed node state", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-false-complete",
      [taskNode("failed-node"), taskNode("pending-node")],
      [{ id: "failed-pending", from: "failed-node", to: "pending-node", kind: "sequence" }],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    graph.status = "running";
    graph.nodes[0]!.status = "failed";
    graph.nodes[1]!.status = "pending";
    (graph as any).runs = [{
      id: "run-active", runNo: 1, status: "running", startedAt: "2026-08-11T00:00:00.000Z",
      trigger: "manual", stats: { completed: 0, failed: 1, attempts: 1 }, nodeResults: [],
    }];
    await writeGraphStore(runtimeDirectory, [graph]);
    await installFakeOrca(runtimeDirectory);
    await writeFile(path.join(runtimeDirectory, "executions.json"), `${JSON.stringify([{
      id: "exec-false-complete", itemKind: "graph", itemId: graph.id, title: graph.name, status: "completed",
      executionMode: "single_session", createdAt: "2026-08-11T00:01:00.000Z", updatedAt: "2026-08-11T00:01:01.000Z",
      startedAt: "2026-08-11T00:01:00.000Z", endedAt: "2026-08-11T00:01:01.000Z",
      progress: { completed: 2, failed: 0, total: 2 },
      targets: [{ id: "target-1", label: "Fake project", status: "completed", environmentId: "local", projectId: "fake-project" }],
    }])}\n`, "utf8");

    await sendToBridge(runtimeDirectory, { type: "execution-status" }, "[bridge] pong", {}, [{ type: "ping" }]);

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0]).toMatchObject({
      status: "failed",
      progress: { completed: 0, failed: 1, total: 2 },
      targets: [{ status: "failed" }],
    });
    expect(records[0].error).toContain("잘못 기록된 완료 상태를 정정");
  });

  it("reuses one newly created session for sequential Graph nodes on the same route", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-unified-session",
      [taskNode("first"), taskNode("second")],
      [{ id: "first-second", from: "first", to: "second", kind: "sequence" }],
      { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "high" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "high" },
      },
      "execution completed",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "create")).toHaveLength(1);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(2);
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs.at(-1).nodeResults).toMatchObject([
      { nodeId: "first", status: "done", sessionId: "fake-session", sessionTitle: "GRAPH-unified-session · Run #1 · Fake project" },
      { nodeId: "second", status: "done", sessionId: "fake-session", sessionTitle: "GRAPH-unified-session · Run #1 · Fake project" },
    ]);
    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0].targets[0]).toMatchObject({ sessionId: "fake-session", sessionTitle: "GRAPH-unified-session · Run #1 · Fake project" });
  });

  it("keeps answering bridge messages while an execution is still running", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-queue-lane",
      [taskNode("only")],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    // 실행이 도는 동안 초기화 요청을 함께 보낸다. 두 작업이 같은 큐에 있으면
    // 초기화는 실행이 끝난 뒤에야 처리된다 — 정작 필요한 순간에 막히는 것이다.
    const output = await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution completed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_WAIT_DELAY_MS: "1200",
      },
      [{ type: "reset-graph-run", graphId: graph.id }],
      { marker: "execution queued", delayMs: 300 },
    );

    expect(output).toContain("graph run state reset");
    expect(output.indexOf("graph run state reset")).toBeLessThan(output.indexOf("execution completed"));
  });

  it("stops a running Graph at the next node boundary when the user cancels", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-cancel",
      [taskNode("first"), taskNode("second"), taskNode("third")],
      [
        { id: "first-second", from: "first", to: "second", kind: "sequence" },
        { id: "second-third", from: "second", to: "third", kind: "sequence" },
      ],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    const output = await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution cancelled",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_WAIT_DELAY_MS: "900",
      },
      [{ type: "cancel-execution", graphId: "GRAPH-cancel" }],
      { marker: "execution queued", delayMs: 200 },
    );

    expect(output).toContain("execution cancel requested");
    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0].status).toBe("cancelled");
    expect(records[0].cancelRequestedAt).toBeTruthy();
    // 중단은 노드 경계에서 관측된다 — 모든 노드를 보내고 끝나는 일은 없어야 한다.
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send").length).toBeLessThan(3);
    // 중단은 실행 레코드와 run 이력 양쪽에서 실패가 아니라 취소로 남아야 한다.
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    const run = after.graphs.find((item: { id: string }) => item.id === graph.id).runs.at(-1);
    expect(run.status).toBe("cancelled");
    expect(run.terminationReason).toBe("cancelled");
  });

  it("keeps a panel save made while an execution is running", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-concurrent-save",
      [taskNode("only")],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);
    const saved = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    // 실행이 도는 동안 사용자가 다른 항목을 저장한다. 실행 진행 기록이 store를
    // 통째로 덮어쓰면 이 편집은 조용히 사라진다.
    saved.todos = [{
      id: "TODO-during-run", title: "실행 중 저장한 Todo", notes: "", status: "todo",
      priority: "medium", tags: [], promptRevisions: [],
      createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z",
    }];

    const output = await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution completed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_WAIT_DELAY_MS: "1200",
      },
      [{ type: "save", store: saved, rebuildPanel: false }],
      { marker: "execution queued", delayMs: 300 },
    );

    expect(output).toContain("graph store saved");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.todos?.map((todo: { id: string }) => todo.id)).toEqual(["TODO-during-run"]);
    // 실행 쪽 기록도 함께 남아야 한다.
    const executed = after.graphs.find((item: { id: string }) => item.id === graph.id);
    expect(executed.runs.at(-1).nodeResults?.length ?? executed.nodes[0].status).toBeTruthy();
  });

  it("resets a Graph run state without touching its structure or run history", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-reset-history",
      [taskNode("first"), taskNode("second")],
      [{ id: "first-second", from: "first", to: "second", kind: "sequence" }],
    );
    graph.nodes[0]!.status = "done";
    graph.nodes[1]!.status = "failed";
    graph.status = "running";
    graph.runs = [{
      id: "run-1", runNo: 1, status: "running", startedAt: "2026-08-11T00:00:00.000Z",
      nodeResults: [{ nodeId: "first", status: "done" }, { nodeId: "second", status: "failed", message: "blocked" }],
    }] as never;
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(runtimeDirectory, { type: "reset-graph-run", graphId: graph.id }, "graph run state reset");

    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    const reset = after.graphs.find((item: { id: string }) => item.id === graph.id);
    expect(reset.nodes.map((node: { id: string; status: string }) => [node.id, node.status])).toEqual([["first", "pending"], ["second", "pending"]]);
    expect(reset.status).toBe("draft");
    // 구조도 이력도 파괴하지 않는다 — 상태만 되돌린다.
    expect(reset.edges).toHaveLength(1);
    expect(reset.runs).toHaveLength(1);
    expect(reset.runs[0]).toMatchObject({ id: "run-1", status: "cancelled", terminationReason: "cancelled" });
    expect(reset.runs[0].nodeResults).toHaveLength(2);
  });

  it("recovers a Graph node from a transient Orca runtime_unavailable during terminal create", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-transient-runtime",
      [taskNode("only")],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution completed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_CREATE_UNAVAILABLE: "2",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "create")).toHaveLength(3);
    expect(calls.some((args) => args[0] === "status")).toBe(true);
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs.at(-1).nodeResults).toMatchObject([{ nodeId: "only", status: "done" }]);
  });

  it("reports why a node stopped when the Orca renderer graph never becomes ready", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-renderer-stuck",
      [taskNode("only")],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution failed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_CREATE_UNAVAILABLE: "99",
        ORCA_GRAPH_FAKE_GRAPH_STATE: "reloading",
        ORCA_GRAPH_TERMINAL_CREATE_TIMEOUT_MS: "1200",
      },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0].status).toBe("failed");
    expect(records[0].error).toContain("runtime_unavailable");
    expect(records[0].error).toContain("graph=reloading");
  });

  it("treats a decorated RESULT: failed line as a node failure", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-decorated-result",
      [taskNode("only")],
      [],
      { projectId: "fake-project", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "single_session",
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
      },
      "execution failed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_ASSISTANT: "**RESULT: failed — 알림톡 템플릿 계약값 누락**",
      },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0].status).toBe("failed");
    expect(records[0].error).toContain("알림톡 템플릿 계약값 누락");
  });

  it("creates and tracks one Graph session per distinct project route", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph(
      "GRAPH-project-sessions",
      [taskNode("api-first"), taskNode("api-second"), taskNode("web", { projectId: "second-project", branch: "release", model: "gpt-5.6-luna" })],
      [
        { id: "api-sequence", from: "api-first", to: "api-second", kind: "sequence" },
        { id: "web-sequence", from: "api-second", to: "web", kind: "sequence" },
      ],
      { projectId: "fake-project", branch: "main", model: "gpt-5.6-sol" },
    );
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targetStore = JSON.parse(await readFile(targetsPath, "utf8"));
    targetStore.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", worktreeId: "second-worktree",
      path: "/portable/second-project", branch: "refs/heads/release",
    });
    targetStore.branches.push({
      id: "release", branch: "refs/heads/release", environmentId: "local", projectId: "second-project",
      repoId: "second-repo", worktreeId: "second-worktree", path: "/portable/second-project",
    });
    await writeFile(targetsPath, `${JSON.stringify(targetStore)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-graph-execution",
        graphId: graph.id,
        executionMode: "per_project",
        projectSessions: [
          { locator: "/portable/fake-project", label: "API", routing: { environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol" } },
          { locator: "/portable/second-project", label: "Web", routing: { environmentId: "local", projectId: "second-project", branch: "release", model: "gpt-5.6-luna" } },
        ],
      },
      "execution completed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const creates = calls.filter((args) => args[0] === "terminal" && args[1] === "create");
    expect(creates).toHaveLength(2);
    expect(creates.map((args) => args[args.indexOf("--worktree") + 1]).sort()).toEqual(["id:fake-worktree", "id:second-worktree"]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(3);
    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0].targets).toMatchObject([
      { locator: "/portable/fake-project", projectId: "fake-project", sessionTitle: "GRAPH-project-sessions · Run #1 · Fake project" },
      { locator: "/portable/second-project", projectId: "second-project", sessionTitle: "GRAPH-project-sessions · Run #1 · Second project" },
    ]);
  });

  it("attests all targets and executes one independent session per Task project with its own model", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-multi-project", title: "다중 프로젝트 Task", prompt: "각 프로젝트 작업", draft: "각 프로젝트 작업",
      promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [
        { id: "target-a", role: "target", locatorKind: "folder", locator: "/recorded/fake-project", label: "API", branch: "main", position: 0 },
        { id: "target-b", role: "target", locatorKind: "folder", locator: "/recorded/second-project", label: "Web", branch: "release", position: 1 },
      ],
      createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", repoId: "second-repo",
      worktreeId: "second-worktree", path: "/portable/second-project", branch: "refs/heads/release",
    });
    targets.projects.push(
      { id: "fake-project", name: "Recorded API", environmentId: "recorded-device", path: "/recorded/fake-project", worktreeId: "recorded-api" },
      { id: "second-project", name: "Recorded Web", environmentId: "recorded-device", path: "/recorded/second-project", worktreeId: "recorded-web" },
    );
    targets.branches.push({
      id: "release", branch: "refs/heads/release", environmentId: "local", projectId: "second-project",
      repoId: "second-repo", worktreeId: "second-worktree", path: "/portable/second-project",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "run-task", taskId: "TASK-multi-project", executionMode: "per_project", dryRun: false,
        projectSessions: [
          { locator: "/recorded/fake-project", routing: { environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol", reasoning: "high" } },
          { locator: "/recorded/second-project", routing: { environmentId: "local", projectId: "second-project", branch: "release", model: "gpt-5.6-luna", reasoning: "medium" } },
        ],
      },
      "task TASK-multi-project executed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const creates = calls.filter((args) => args[0] === "terminal" && args[1] === "create");
    expect(creates).toHaveLength(2);
    expect(creates.some((args) => args.includes("id:fake-worktree") && args.join(" ").includes("gpt-5.6-sol"))).toBe(true);
    expect(creates.some((args) => args.includes("id:second-worktree") && args.join(" ").includes("gpt-5.6-luna"))).toBe(true);
    const sends = calls.filter((args) => args[0] === "terminal" && args[1] === "send");
    expect(sends).toHaveLength(2);
    const apiPrompt = sends.find((args) => args.join("\n").includes("target · folder: /recorded/fake-project"))?.join("\n") ?? "";
    const webPrompt = sends.find((args) => args.join("\n").includes("target · folder: /recorded/second-project"))?.join("\n") ?? "";
    expect(apiPrompt).not.toContain("/recorded/second-project");
    expect(webPrompt).not.toContain("/recorded/fake-project");
  });

  it("executes multiple selected Orca projects even when the Task has no saved target projects", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const now = "2026-08-10T00:00:00.000Z";
    await writeGraphStore(runtimeDirectory, [], [{
      id: "TASK-runtime-projects", title: "실행 시 프로젝트 선택", prompt: "선택한 프로젝트에서 실행", draft: "선택한 프로젝트에서 실행",
      promptRevisions: [], status: "ready", priority: "medium", tags: [], projects: [], createdAt: now, updatedAt: now,
    }]);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", repoId: "second-repo",
      worktreeId: "second-worktree", path: "/portable/second-project", branch: "refs/heads/release",
    });
    targets.branches.push({
      id: "release", branch: "refs/heads/release", environmentId: "local", projectId: "second-project",
      repoId: "second-repo", worktreeId: "second-worktree", path: "/portable/second-project",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "run-task", taskId: "TASK-runtime-projects", executionMode: "per_project", dryRun: false,
        projectSessions: [
          { locator: "/portable/fake-project", routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" } },
          { locator: "/portable/second-project", routing: { environmentId: "local", projectId: "second-project", branch: "release", model: "gpt-5.6-luna" } },
        ],
      },
      "task TASK-runtime-projects executed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const creates = calls.filter((args) => args[0] === "terminal" && args[1] === "create");
    expect(creates).toHaveLength(2);
    expect(creates.map((args) => args[args.indexOf("--worktree") + 1]).sort()).toEqual(["id:fake-worktree", "id:second-worktree"]);
    const sends = calls.filter((args) => args[0] === "terminal" && args[1] === "send");
    expect(sends.some((args) => args.join("\n").includes("target · folder: /portable/fake-project"))).toBe(true);
    expect(sends.some((args) => args.join("\n").includes("target · folder: /portable/second-project"))).toBe(true);
  });

  it("keeps every selected project in one integrated Task session", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const now = "2026-08-10T00:00:00.000Z";
    await writeGraphStore(runtimeDirectory, [], [{
      id: "TASK-integrated-projects", title: "통합 프로젝트 실행", prompt: "한 세션에서 여러 프로젝트 작업", draft: "한 세션에서 여러 프로젝트 작업",
      promptRevisions: [], status: "ready", priority: "medium", tags: [], projects: [], createdAt: now, updatedAt: now,
    }]);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", repoId: "second-repo",
      worktreeId: "second-worktree", path: "/portable/second-project", branch: "refs/heads/release",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "run-task", taskId: "TASK-integrated-projects", executionMode: "single_session", dryRun: false,
        routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" },
        projectSessions: [
          { locator: "/portable/fake-project", routing: { environmentId: "local", projectId: "fake-project", model: "gpt-5.6-sol" } },
          { locator: "/portable/second-project", routing: { environmentId: "local", projectId: "second-project", model: "gpt-5.6-luna" } },
        ],
      },
      "task TASK-integrated-projects executed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "create")).toHaveLength(1);
    const prompt = calls.find((args) => args[0] === "terminal" && args[1] === "send")?.join("\n") ?? "";
    expect(prompt).toContain("target · folder: /portable/fake-project");
    expect(prompt).toContain("target · folder: /portable/second-project");
  });

  it("waits for every project session before finalizing a partially failed tracked Task", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-partial", title: "부분 실패 Task", prompt: "프로젝트별 실행", draft: "프로젝트별 실행",
      promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [
        { id: "target-a", role: "target", locatorKind: "folder", locator: "/portable/fake-project", label: "API", branch: "main", position: 0 },
        { id: "target-b", role: "target", locatorKind: "folder", locator: "/portable/second-project", label: "Web", branch: "release", position: 1 },
      ],
      createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", repoId: "second-repo",
      worktreeId: "second-worktree", path: "/portable/second-project", branch: "refs/heads/release",
    });
    targets.branches.push({
      id: "release", branch: "refs/heads/release", environmentId: "local", projectId: "second-project",
      repoId: "second-repo", worktreeId: "second-worktree", path: "/portable/second-project",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-task-execution", taskId: "TASK-partial", executionMode: "per_project",
        projectSessions: [
          { locator: "/portable/fake-project", routing: { environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol" } },
          { locator: "/portable/second-project", routing: { environmentId: "local", projectId: "second-project", branch: "release", model: "gpt-5.6-luna" } },
        ],
      },
      "execution failed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
        ORCA_GRAPH_FAKE_FAIL_SECOND: "1",
      },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0]).toMatchObject({
      itemKind: "task", itemId: "TASK-partial", status: "failed",
      progress: { completed: 1, failed: 1, total: 2 },
      targets: [
        { label: "API", status: "completed", sessionId: "fake-session" },
        { label: "Web", status: "failed", error: "second project launch failed" },
      ],
    });
    expect(records[0].error).toContain("1/2 project executions failed");
  });

  it("fails a tracked Task when the agent reports RESULT: failed and keeps its session", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-blocked", title: "차단된 Task", prompt: "계약값을 확인한다", draft: "계약값을 확인한다",
      promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [{ id: "blocked-target", role: "target", locatorKind: "folder", locator: "/portable/fake-project", label: "Fake project", branch: "main", position: 0 }],
      createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "start-task-execution", taskId: "TASK-blocked", routing: { environmentId: "local", sessionId: "fake-session", model: "gpt-5.6-sol" } },
      "execution failed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_ASSISTANT: "RESULT: failed — 필수 계약값 누락으로 blocked",
      },
    );

    const records = JSON.parse(await readFile(path.join(runtimeDirectory, "executions.json"), "utf8"));
    expect(records[0]).toMatchObject({
      itemKind: "task", itemId: "TASK-blocked", status: "failed",
      progress: { completed: 0, failed: 1, total: 1 },
      targets: [{ status: "failed", sessionId: "fake-session" }],
    });
    expect(records[0].error).toContain("필수 계약값 누락으로 blocked");
    // 계약 문구가 실제로 에이전트에게 전달되어야 판정이 성립한다.
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const sent = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    expect(sent?.join(" ")).toContain("RESULT: done");
  });

  it("does not serialize per-project agent waits behind each other", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-parallel", title: "동시 실행 Task", prompt: "프로젝트별 실행", draft: "프로젝트별 실행",
      promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [
        { id: "target-a", role: "target", locatorKind: "folder", locator: "/portable/fake-project", label: "API", branch: "main", position: 0 },
        { id: "target-b", role: "target", locatorKind: "folder", locator: "/portable/second-project", label: "Web", branch: "release", position: 1 },
      ],
      createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const waitTrace = path.join(runtimeDirectory, "wait-trace.log");
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.projects.push({
      id: "second-project", name: "Second project", environmentId: "local", repoId: "second-repo",
      worktreeId: "second-worktree", path: "/portable/second-project", branch: "refs/heads/release",
    });
    targets.branches.push({
      id: "release", branch: "refs/heads/release", environmentId: "local", projectId: "second-project",
      repoId: "second-repo", worktreeId: "second-worktree", path: "/portable/second-project",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      {
        type: "start-task-execution", taskId: "TASK-parallel", executionMode: "per_project",
        projectSessions: [
          { locator: "/portable/fake-project", routing: { environmentId: "local", projectId: "fake-project", branch: "main", model: "gpt-5.6-sol" } },
          { locator: "/portable/second-project", routing: { environmentId: "local", projectId: "second-project", branch: "release", model: "gpt-5.6-luna" } },
        ],
      },
      "execution completed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_SECOND_PROJECT: "1",
        ORCA_GRAPH_FAKE_WAIT_TRACE: waitTrace,
        ORCA_GRAPH_FAKE_WAIT_DELAY_MS: "600",
      },
    );

    // 두 프로젝트의 tui-idle 대기가 겹쳐야 한다. 전역 큐에 묶이면 start,end,start,end로
    // 완전히 분리되고 뒤 프로젝트는 자기 폴링 예산을 큐에서 다 써버린다.
    const trace = (await readFile(waitTrace, "utf8")).trim().split("\n").filter(Boolean);
    expect(trace.length).toBeGreaterThanOrEqual(4);
    expect(trace.slice(0, 2)).toEqual(["start", "start"]);
  });

  it("executes one Todo directly in the selected Orca worktree", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.todos = [{
      id: "TODO-standalone",
      title: "빠른 실행 Todo",
      notes: "검증 메모",
      groupName: "플러그인",
      subgroupName: "실행",
      draft: "사람 Todo Draft",
      metaDraft: "  현재 Todo Meta Draft  \n두번째 줄\n",
      promptRevisions: [
        { id: "todo-draft", kind: "draft", revision: 1, content: "사람 Todo Draft", status: "current", generator: "human", createdAt: now },
        { id: "todo-meta", kind: "meta", revision: 2, content: "  현재 Todo Meta Draft  \n두번째 줄\n", status: "current", basedOnId: "todo-draft", generator: "meta-prompt-agent", createdAt: now },
      ],
      status: "open",
      priority: "medium",
      tags: [],
      createdAt: now,
      updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const environment = { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog };

    await sendToBridge(
      runtimeDirectory,
      { type: "run-todo", todoId: "TODO-standalone", routing: { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "medium" }, dryRun: true },
      "todo TODO-standalone planned",
      environment,
    );
    expect(await readCallLog(fake.callLog)).toBe("");

    await sendToBridge(
      runtimeDirectory,
      { type: "run-todo", todoId: "TODO-standalone", routing: { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "medium" }, dryRun: false },
      "todo TODO-standalone executed",
      environment,
    );
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const create = calls.find((args) => args[0] === "terminal" && args[1] === "create");
    const send = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    expect(create).toEqual(expect.arrayContaining(["--worktree", "id:fake-worktree", "--title", "Todo · 빠른 실행 Todo"]));
    expect(send?.join("\n")).toContain("Todo: 빠른 실행 Todo (TODO-standalone)");
    expect(send?.join("\n")).toContain("Todo prompt:\n  현재 Todo Meta Draft  \n두번째 줄\n\n");
    expect(send?.join("\n")).toContain("Todo group: 플러그인 / 실행");
    expect(send?.join("\n")).toContain("Todo notes:\n검증 메모");
    expect(send?.join("\n")).not.toContain("사람 Todo Draft");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.todos.find((todo: { id: string }) => todo.id === "TODO-standalone")?.status).toBe("open");
    expect(after.graphs.every((graph: { runs: unknown[] }) => graph.runs.length === 0)).toBe(true);
  });

  it("executes one Task through the selected remote Orca environment", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const now = "2026-08-10T00:00:00.000Z";
    store.tasks = [{
      id: "TASK-remote", title: "원격 단건 Task", prompt: "원격 실행", draft: "원격 실행",
      promptRevisions: [], status: "ready", priority: "medium", tags: [], createdAt: now, updatedAt: now,
    }];
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.environments.push({ id: "env-jsj2", name: "jsj2", local: false, connected: true });
    targets.projects.push({ id: "remote-project", name: "Remote project", environmentId: "env-jsj2", worktreeId: "remote-worktree" });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      { type: "run-task", taskId: "TASK-remote", routing: { environmentId: "env-jsj2", projectId: "remote-project", model: "gpt-5.6-sol" }, dryRun: false },
      "task TASK-remote executed",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    for (const args of calls.filter((item) => item[0] === "terminal" || item[0] === "worktree")) {
      expect(args).toEqual(expect.arrayContaining(["--environment", "env-jsj2"]));
    }
    expect(calls.some((args) => args[0] === "terminal" && args[1] === "create" && args.includes("id:remote-worktree"))).toBe(true);
  });

  it("creates a new session in the selected existing Orca worktree branch", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph("worktree-branch", [taskNode("branch-task")], [], {
      projectId: "fake-project", branch: "feature/review", model: "gpt-5.6-sol",
    });
    await writeGraphStore(runtimeDirectory, [graph]);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.branches.push({
      id: "feature", branch: "refs/heads/feature/review", environmentId: "local",
      projectId: "fake-project", repoId: "fake-repo", worktreeId: "fake-feature-worktree",
      path: "/portable/fake-project-feature",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_BRANCH: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.find((args) => args[0] === "terminal" && args[1] === "create"))
      .toEqual(expect.arrayContaining(["--worktree", "id:fake-feature-worktree"]));
    expect(calls.find((args) => args[0] === "terminal" && args[1] === "send")?.join("\n"))
      .toContain("- branch: feature/review");
  });

  it("infers a graph node project and exact worktree branch from the Task target relation", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const graph = executionGraph("task-target-route", [taskNode("target-task")], [], {
      model: "gpt-5.6-sol",
    });
    const now = "2026-08-10T00:00:00.000Z";
    await writeGraphStore(runtimeDirectory, [graph], [{
      id: "task-target-task", title: "target-task", prompt: "execute target-task",
      draft: "execute target-task", promptRevisions: [], status: "ready", priority: "medium", tags: [],
      projects: [{
        id: "relation-1", role: "target", locatorKind: "folder", locator: "/portable/fake-project",
        label: "Fake project", branch: "feature/review", position: 0,
      }],
      createdAt: now, updatedAt: now,
    }]);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    targets.branches.push({
      id: "feature", branch: "refs/heads/feature/review", environmentId: "local",
      projectId: "fake-project", repoId: "fake-repo", worktreeId: "fake-feature-worktree",
      path: "/portable/fake-project-feature",
    });
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: "task-target-route", dryRun: false },
      "graph task-target-route executed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_BRANCH: "1",
      },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const create = calls.find((args) => args[0] === "terminal" && args[1] === "create");
    const send = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    expect(create).toEqual(expect.arrayContaining(["--worktree", "id:fake-feature-worktree"]));
    expect(send?.join("\n")).toContain("target · folder: /portable/fake-project · branch feature/review");
    expect(send?.join("\n")).toContain("- branch: feature/review");
  });

  it("plans a child graph recursively and records bidirectional run lineage", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const storeFixture = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    storeFixture.graphs[0].defaults.projectId = "fake-project";
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(storeFixture)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: "graph-orca-demo", dryRun: true },
      "graph graph-orca-demo planned",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const store = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    const parent = store.graphs.find((graph: { id: string }) => graph.id === "graph-orca-demo");
    const nested = store.graphs.find((graph: { id: string }) => graph.id === "graph-quality-check");
    const parentRun = parent.runs.at(-1);
    const childRun = nested.runs.at(-1);
    expect(parentRun.status).toBe("planned");
    expect(childRun.status).toBe("planned");
    expect(parentRun.childRunIds).toEqual([childRun.id]);
    expect(childRun).toMatchObject({
      parentRunId: parentRun.id,
      parentGraphId: parent.id,
      parentNodeId: "node-quality-graph-call",
    });
    expect(childRun.nodeResults[0].message).toContain("gpt-5.6-sol");
    expect(parentRun.nodeResults.at(-1)).toMatchObject({
      nodeId: "node-quality-graph-call",
      childGraphId: nested.id,
      childRunId: childRun.id,
    });
    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("rejects live loop execution before creating runs or sending Orca commands", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fixture = await readFile(path.join(root, "fixtures/default-store.json"), "utf8");
    await writeFile(path.join(runtimeDirectory, "store.json"), fixture, "utf8");
    const before = JSON.parse(fixture);

    const output = await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: "graph-orca-demo", dryRun: false },
      "live loop re-entry is not supported by the local bridge",
    );

    expect(output).toContain("graph preflight failed");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs.map((graph: { runs: unknown[] }) => graph.runs.length))
      .toEqual(before.graphs.map((graph: { runs: unknown[] }) => graph.runs.length));
  });

  it("records why an unselected condition branch was closed", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const graph = store.graphs[0];
    graph.id = "branch-observability";
    graph.name = "Branch observability";
    graph.edges = [
      { id: "edge-y", from: "condition", to: "selected", kind: "sequence", branch: "y" },
      { id: "edge-n", from: "condition", to: "closed", kind: "sequence", branch: "n" },
      { id: "selected-any", from: "selected", to: "merge-any", kind: "sequence" },
      { id: "closed-any", from: "closed", to: "merge-any", kind: "sequence" },
      { id: "selected-all", from: "selected", to: "merge-all", kind: "sequence" },
      { id: "closed-all", from: "closed", to: "merge-all", kind: "sequence" },
    ];
    graph.nodes = [
      { id: "condition", kind: "condition", label: "Decision", x: 0, y: 0, status: "pending", joinMode: "all", conditionExpr: "continue?", branchTaken: "y" },
      { id: "selected", kind: "task", label: "Selected", x: 1, y: 0, status: "pending", joinMode: "all", task: { id: "task-y", title: "Selected", prompt: "selected" } },
      { id: "closed", kind: "task", label: "Closed", x: 1, y: 1, status: "pending", joinMode: "all", task: { id: "task-n", title: "Closed", prompt: "closed" } },
      { id: "merge-any", kind: "task", label: "OR merge", x: 2, y: 0, status: "pending", joinMode: "any", task: { id: "task-any", title: "OR merge", prompt: "merge any" } },
      { id: "merge-all", kind: "task", label: "AND merge", x: 2, y: 1, status: "pending", joinMode: "all", task: { id: "task-all", title: "AND merge", prompt: "merge all" } },
    ];
    graph.defaults = { projectId: "fake-project", model: "gpt-5.6-sol", reasoning: "high" };
    graph.runs = [];
    store.graphs = [graph];
    store.activeGraphId = graph.id;
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: true },
      `graph ${graph.id} planned`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs[0].nodeResults.find((result: { nodeId: string }) => result.nodeId === "closed")).toMatchObject({
      status: "skipped",
      message: "Decision selected 'y', expected 'n'",
    });
    expect(after.graphs[0].runs[0].nodeResults.find((result: { nodeId: string }) => result.nodeId === "merge-any")).toMatchObject({ status: "pending" });
    expect(after.graphs[0].runs[0].nodeResults.find((result: { nodeId: string }) => result.nodeId === "merge-all")).toMatchObject({
      status: "skipped",
      message: "Closed is branch-closed",
    });
    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("propagates a selected branch through live OR and AND joins", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const graph = store.graphs[0];
    graph.id = "live-branch-propagation";
    graph.name = "Live branch propagation";
    graph.edges = [
      { id: "edge-y", from: "condition", to: "selected", kind: "sequence", branch: " y " },
      { id: "edge-n", from: "condition", to: "closed", kind: "sequence", branch: "n" },
      { id: "selected-any", from: "selected", to: "merge-any", kind: "sequence" },
      { id: "closed-any", from: "closed", to: "merge-any", kind: "sequence" },
      { id: "selected-all", from: "selected", to: "merge-all", kind: "sequence" },
      { id: "closed-all", from: "closed", to: "merge-all", kind: "sequence" },
    ];
    graph.nodes = [
      { id: "condition", kind: "condition", label: "Decision", x: 0, y: 0, status: "pending", joinMode: "all", conditionExpr: "continue?", branchTaken: "y" },
      { id: "selected", kind: "task", label: "Selected", x: 1, y: 0, status: "pending", joinMode: "all", task: { id: "task-y", title: "Selected", prompt: "selected" } },
      { id: "closed", kind: "task", label: "Closed", x: 1, y: 1, status: "pending", joinMode: "all", task: { id: "task-n", title: "Closed", prompt: "closed" } },
      { id: "merge-any", kind: "task", label: "OR merge", x: 2, y: 0, status: "pending", joinMode: "any", task: { id: "task-any", title: "OR merge", prompt: "merge any" } },
      { id: "merge-all", kind: "task", label: "AND merge", x: 2, y: 1, status: "pending", joinMode: "all", task: { id: "task-all", title: "AND merge", prompt: "merge all" } },
    ];
    graph.defaults = { sessionId: "fake-session" };
    graph.runs = [];
    store.graphs = [graph];
    store.activeGraphId = graph.id;
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    const results = after.graphs[0].runs[0].nodeResults;
    expect(results.find((result: { nodeId: string }) => result.nodeId === "closed")).toMatchObject({ status: "skipped" });
    expect(results.find((result: { nodeId: string }) => result.nodeId === "merge-any")).toMatchObject({ status: "done" });
    expect(results.find((result: { nodeId: string }) => result.nodeId === "merge-all")).toMatchObject({ status: "skipped" });
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    // One plan-level idle attestation plus one completion wait per selected task.
    // Send-time readiness and turn start are attested from the live agent pane state.
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "wait")).toHaveLength(3);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(2);
  });

  it("rejects an invalid selected branch even when the panel is bypassed", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const condition = store.graphs[0].nodes.find((node: { kind: string }) => node.kind === "condition");
    condition.branchTaken = "missing-branch";
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const beforeRunCounts = store.graphs.map((graph: { runs: unknown[] }) => graph.runs.length);

    const output = await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: store.graphs[0].id, dryRun: true },
      "selected branch 'missing-branch' has no matching output edge",
    );

    expect(output).toContain("graph preflight failed");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs.map((graph: { runs: unknown[] }) => graph.runs.length)).toEqual(beforeRunCounts);
  });

  it("evaluates an undecided condition from upstream agent results during live execution", async () => {
    const root = process.cwd();
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const store = JSON.parse(await readFile(path.join(root, "fixtures/default-store.json"), "utf8"));
    const graph = store.graphs[0];
    graph.edges = graph.edges.filter((edge: { kind: string }) => edge.kind !== "loop");
    graph.defaults = { sessionId: "fake-session" };
    for (const node of graph.nodes) {
      if (node.routing) delete node.routing.reasoning;
    }
    const condition = graph.nodes.find((node: { kind: string }) => node.kind === "condition");
    delete condition.branchTaken;
    await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
    const fake = await installFakeOrca(runtimeDirectory);
    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_ASSISTANT: '{"branch":"y","reason":"blocking finding exists"}',
      },
    );

    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    const result = after.graphs[0].runs[0].nodeResults.find((item: { nodeId: string }) => item.nodeId === condition.id);
    expect(result).toMatchObject({ status: "done" });
    expect(result.message).toContain("branch=y · AI 자동 판정");
    expect(after.graphs[0].nodes.find((item: { id: string }) => item.id === condition.id)).not.toHaveProperty("branchTaken");
  }, 15_000);

  describe.each(["root", "child"] as const)("%s pure route scope", (scope) => {
    describe.each([true, false])("dryRun=%s", (dryRun) => {
      for (const failure of pureRouteFailures) {
        it(`rejects ${failure.id} with zero runs and zero Orca calls`, async () => {
          const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
          temporaryDirectories.push(runtimeDirectory);
          const fake = await installFakeOrca(runtimeDirectory);
          const invalidTask = taskNode(`invalid-${failure.id}`, failure.routing);
          const graphs = scope === "root"
            ? [executionGraph(`root-${failure.id}`, [invalidTask], [], {})]
            : [
              executionGraph(`root-${failure.id}`, [{
                ...taskNode("call-child"),
                kind: "graph_call",
                childGraphId: `child-${failure.id}`,
                graphCallRoutingMode: "child",
              }], [], {}),
              executionGraph(`child-${failure.id}`, [invalidTask], [], {}),
            ];
          await writeGraphStore(runtimeDirectory, graphs);

          const output = await sendToBridge(
            runtimeDirectory,
            { type: "run", graphId: graphs[0]!.id, dryRun },
            failure.expected,
            { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
          );

          expect(output).toContain("execution plan preflight failed");
          const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
          expect(after.graphs.map((graph: { runs: unknown[] }) => graph.runs)).toEqual(graphs.map(() => []));
          expect(await readCallLog(fake.callLog)).toBe("");
        });
      }
    });
  });

  it("rejects a missing downstream session before any run or Orca call", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("missing-downstream-session", [
      taskNode("valid-first"),
      taskNode("invalid-second", { sessionId: "missing-session" }),
    ], [{ id: "first-second", from: "valid-first", to: "invalid-second", kind: "sequence" }]);
    await writeGraphStore(runtimeDirectory, [graph]);

    const output = await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      "session unavailable: missing-session",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    expect(output).toContain("execution plan preflight failed");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs).toEqual([]);
    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("rejects a downstream graph-call depth overflow before any run or Orca call", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const rootGraph = executionGraph("depth-root", [
      taskNode("valid-first"),
      { ...taskNode("call-child"), kind: "graph_call", childGraphId: "depth-child-a" },
    ], [{ id: "first-child", from: "valid-first", to: "call-child", kind: "sequence" }]);
    rootGraph.engineering.traversalHopLimit = 1;
    const childA = executionGraph("depth-child-a", [
      { ...taskNode("call-grandchild"), kind: "graph_call", childGraphId: "depth-child-b" },
    ]);
    const childB = executionGraph("depth-child-b", [taskNode("never-dispatched")]);
    await writeGraphStore(runtimeDirectory, [rootGraph, childA, childB]);

    const output = await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: rootGraph.id, dryRun: false },
      "graph-call depth limit exceeded (1)",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    expect(output).toContain("execution plan preflight failed");
    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs.map((item: { runs: unknown[] }) => item.runs)).toEqual([[], [], []]);
    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("preflights only the selected executable branch", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const decision = {
      ...taskNode("decision"),
      kind: "condition",
      conditionExpr: "choose route",
      branchTaken: "y",
    };
    const graph = executionGraph("selected-route-only", [
      decision,
      taskNode("selected"),
      taskNode("closed", { sessionId: "missing-session" }),
    ], [
      { id: "selected-edge", from: "decision", to: "selected", kind: "sequence", branch: "y" },
      { id: "closed-edge", from: "decision", to: "closed", kind: "sequence", branch: "n" },
    ]);
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(1);
  });

  describe.each([
    ["shell", "session is not a proven agent terminal"],
    ["busy", "session agent is not idle"],
    ["stale", "session pane identity is stale"],
    ["missing-identity", "session is not a proven agent terminal"],
    ["idle-timeout", "session agent did not reach tui-idle"],
  ])("existing-session %s boundary", (mode, expected) => {
    it("fails closed without sending terminal input", async () => {
      const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
      temporaryDirectories.push(runtimeDirectory);
      const fake = await installFakeOrca(runtimeDirectory);
      const graph = executionGraph(`session-${mode}`, [taskNode("work")]);
      await writeGraphStore(runtimeDirectory, [graph]);

      const output = await sendToBridge(
        runtimeDirectory,
        { type: "run", graphId: graph.id, dryRun: false },
        expected,
        {
          ORCA_CLI_COMMAND: fake.command,
          ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
          ORCA_GRAPH_FAKE_MODE: mode,
          ORCA_GRAPH_SESSION_IDLE_TIMEOUT_MS: "1000",
        },
      );

      expect(output).toContain(expected);
      const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
      expect(after.graphs[0].runs).toEqual([]);
      const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
      expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toEqual([]);
    });
  });

  it("attests an idle agent for the plan and again immediately before existing-session send", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("existing-session-idle-positive", [taskNode("work")]);
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    const idleWaitIndexes = calls
      .map((args, index) => args[0] === "terminal" && args[1] === "wait" && args.includes("tui-idle") ? index : -1)
      .filter((index) => index >= 0);
    const sendIndexes = calls
      .map((args, index) => args[0] === "terminal" && args[1] === "send" ? index : -1)
      .filter((index) => index >= 0);
    expect(idleWaitIndexes).toHaveLength(2);
    expect(sendIndexes).toHaveLength(1);
    expect(idleWaitIndexes[0]!).toBeLessThan(sendIndexes[0]!);
  });

  it("rejects cached sessions with missing agent identity before any Orca call", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const targetsPath = path.join(runtimeDirectory, "targets.json");
    const targets = JSON.parse(await readFile(targetsPath, "utf8"));
    delete targets.sessions[0].paneKey;
    await writeFile(targetsPath, `${JSON.stringify(targets)}\n`, "utf8");
    const graph = executionGraph("missing-cached-identity", [taskNode("work")]);
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      "session agent identity is unavailable",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("rejects an existing-session model family mismatch before any Orca call", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("model-family-mismatch", [taskNode("work")], [], {
      sessionId: "fake-session",
      model: "claude-opus-5",
    });
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      "session agent/model mismatch",
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    expect(await readCallLog(fake.callLog)).toBe("");
  });

  it("lets an explicitly selected Orca session determine the actual project", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("existing-session-project-mismatch", [taskNode("work")], [], {
      projectId: "second-project",
      sessionId: "fake-session",
    });
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(1);
  });

  describe.each([true, false])("existing-session reasoning override dryRun=%s", (dryRun) => {
    it("rejects instead of silently ignoring the requested effort", async () => {
      const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
      temporaryDirectories.push(runtimeDirectory);
      const fake = await installFakeOrca(runtimeDirectory);
      const graph = executionGraph("existing-session-reasoning", [taskNode("work")], [], {
        sessionId: "fake-session",
        reasoning: "high",
      });
      await writeGraphStore(runtimeDirectory, [graph]);

      await sendToBridge(
        runtimeDirectory,
        { type: "run", graphId: graph.id, dryRun },
        "existing session reasoning override is unsupported",
        { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
      );

      const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
      expect(after.graphs[0].runs).toEqual([]);
      expect(await readCallLog(fake.callLog)).toBe("");
    });
  });

  describe.each([
    ["claude-opus-5", "claude", "low"],
    ["claude-opus-5", "claude", "medium"],
    ["claude-opus-5", "claude", "high"],
    ["claude-opus-5", "claude", "xhigh"],
    ["claude-opus-5", "claude", "max"],
    ["gpt-5.6-sol", "codex", "low"],
    ["gpt-5.6-sol", "codex", "medium"],
    ["gpt-5.6-sol", "codex", "high"],
    ["gpt-5.6-sol", "codex", "xhigh"],
    ["gpt-5.6-sol", "codex", "max"],
    ["gpt-5.6-sol", "codex", "ultra"],
    ["gpt-5.6-luna", "codex", "max"],
  ] as const)("%s command capture", (model, agent, reasoning) => {
    it(`passes ${reasoning} through the ${agent} CLI contract`, async () => {
      const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
      temporaryDirectories.push(runtimeDirectory);
      const fake = await installFakeOrca(runtimeDirectory);
      const graph = executionGraph(`command-${agent}-${reasoning}`, [taskNode("work")], [], {
        projectId: "fake-project",
        model,
        reasoning,
      });
      await writeGraphStore(runtimeDirectory, [graph]);

      await sendToBridge(
        runtimeDirectory,
        { type: "run", graphId: graph.id, dryRun: false },
        `graph ${graph.id} executed`,
        { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
      );

      const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
      const create = calls.find((args) => args[0] === "terminal" && args[1] === "create");
      const commandIndex = create?.indexOf("--command") ?? -1;
      const expected = agent === "claude"
        ? `claude --model '${model}' --effort '${reasoning}'`
        : `codex --model '${model}' -c model_reasoning_effort='${reasoning}'`;
      expect(commandIndex).toBeGreaterThan(-1);
      expect(create?.[commandIndex + 1]).toBe(expected);
    });
  });

  describe.each([
    ["claude-opus-5", "ultra"],
    ["gpt-5.6-luna", "ultra"],
  ] as const)("%s unsupported reasoning", (model, reasoning) => {
    it.each([true, false])(`rejects ${reasoning} in dryRun=%s before runs or Orca calls`, async (dryRun) => {
      const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
      temporaryDirectories.push(runtimeDirectory);
      const fake = await installFakeOrca(runtimeDirectory);
      const graph = executionGraph(`unsupported-${model}-${dryRun}`, [taskNode("work")], [], {
        projectId: "fake-project",
        model,
        reasoning,
      });
      await writeGraphStore(runtimeDirectory, [graph]);

      await sendToBridge(
        runtimeDirectory,
        { type: "run", graphId: graph.id, dryRun },
        `reasoning policy is not supported by ${model}: ${reasoning}`,
        { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
      );

      const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
      expect(after.graphs[0].runs).toEqual([]);
      expect(await readCallLog(fake.callLog)).toBe("");
    });
  });

  it("rejects a stale project worktree before run creation or terminal mutation", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("missing-live-worktree", [taskNode("new-agent")], [], {
      projectId: "fake-project",
      model: "gpt-5.6-sol",
    });
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      "project worktree is unavailable",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_MODE: "missing-worktree",
      },
    );

    const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
    expect(after.graphs[0].runs).toEqual([]);
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && ["create", "send"].includes(args[1] ?? ""))).toEqual([]);
  });

  it("uses a session project as the fresh-context fallback and launches a new agent", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);
    const graph = executionGraph("fresh-session-fallback", [
      taskNode("fresh-work", {}, { contextMode: "fresh" }),
    ]);
    await writeGraphStore(runtimeDirectory, [graph]);

    await sendToBridge(
      runtimeDirectory,
      { type: "run", graphId: graph.id, dryRun: false },
      `graph ${graph.id} executed`,
      { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
    );

    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "create")).toHaveLength(1);
    expect(calls.filter((args) => args[0] === "terminal" && args[1] === "send")).toHaveLength(1);
  });

  describe.each([
    ["idle-agent", 1],
    ["shell", 0],
  ])("target refresh in %s mode", (mode, expectedSessions) => {
    it("publishes only terminals with a joined Orca agent pane", async () => {
      const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
      temporaryDirectories.push(runtimeDirectory);
      const fake = await installFakeOrca(runtimeDirectory);

      await sendToBridge(
        runtimeDirectory,
        { type: "refresh" },
        "Orca targets refreshed",
        {
          ORCA_CLI_COMMAND: fake.command,
          ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
          ORCA_GRAPH_FAKE_MODE: mode,
        },
      );

      const targets = JSON.parse(await readFile(path.join(runtimeDirectory, "targets.json"), "utf8"));
      expect(targets.projects).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "fake-project", current: true }),
      ]));
      expect(targets.sessions).toHaveLength(expectedSessions);
      if (expectedSessions) {
        expect(targets.sessions[0]).toMatchObject({
          id: "fake-session",
          paneKey: "fake-tab:fake-leaf",
          agentType: "codex",
          agentState: "done",
        });
      }
    });
  });

  it("discovers saved Orca environments and scopes their projects and sessions", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
    temporaryDirectories.push(runtimeDirectory);
    const fake = await installFakeOrca(runtimeDirectory);

    await sendToBridge(
      runtimeDirectory,
      { type: "refresh" },
      "Orca targets refreshed",
      {
        ORCA_CLI_COMMAND: fake.command,
        ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog,
        ORCA_GRAPH_FAKE_REMOTE: "1",
        ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME: "jsj1",
      },
    );

    const targets = JSON.parse(await readFile(path.join(runtimeDirectory, "targets.json"), "utf8"));
    expect(targets.environments).toEqual([
      { id: "local", name: "jsj1", local: true, connected: true },
      { id: "env-jsj2", name: "jsj2", local: false, connected: true },
    ]);
    expect(targets.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fake-project", environmentId: "local" }),
      expect.objectContaining({ id: "remote-project", environmentId: "env-jsj2" }),
    ]));
    expect(targets.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "fake-session", environmentId: "local" }),
      expect.objectContaining({ id: "remote-session", environmentId: "env-jsj2" }),
    ]));
    const calls = (await readCallLog(fake.callLog)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    expect(calls.some((args) => args[0] === "project" && args[1] === "list" && args.includes("env-jsj2"))).toBe(true);
  });

  describe("shared graph validation matrix", () => {
    for (const item of validationFixtureCases.filter((candidate) => candidate.expected.code)) {
      it(`rejects ${item.id} before run creation or Orca invocation`, async () => {
        const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
        temporaryDirectories.push(runtimeDirectory);
        const graph = graphFromValidationFixture(item);
        const store = { schemaVersion: 1, activeGraphId: graph.id, graphs: [graph] };
        await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
        const fake = await installFakeOrca(runtimeDirectory);

        const output = await sendToBridge(
          runtimeDirectory,
          { type: "run", graphId: graph.id, dryRun: item.bridgeMode === "dry" },
          `[${item.expected.severity}:${item.expected.code}]`,
          { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
        );

        expect(output).toContain("graph preflight failed");
        const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
        expect(after.graphs[0].runs).toEqual([]);
        expect(await readCallLog(fake.callLog)).toBe("");
      });
    }

    for (const item of validationFixtureCases.filter((candidate) => !candidate.expected.code)) {
      it(`accepts ${item.id} and crosses the positive live boundary`, async () => {
        const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "orca-graph-engineering-"));
        temporaryDirectories.push(runtimeDirectory);
        const graph = graphFromValidationFixture(item);
        const store = { schemaVersion: 1, activeGraphId: graph.id, graphs: [graph] };
        await writeFile(path.join(runtimeDirectory, "store.json"), `${JSON.stringify(store)}\n`, "utf8");
        const fake = await installFakeOrca(runtimeDirectory);

        await sendToBridge(
          runtimeDirectory,
          { type: "run", graphId: graph.id, dryRun: false },
          `graph ${graph.id} executed`,
          { ORCA_CLI_COMMAND: fake.command, ORCA_GRAPH_FAKE_CALL_LOG: fake.callLog },
        );

        const after = JSON.parse(await readFile(path.join(runtimeDirectory, "store.json"), "utf8"));
        expect(after.graphs[0].runs[0].status).toBe("done");
        expect(await readCallLog(fake.callLog)).toContain("terminal");
      });
    }
  });
});
