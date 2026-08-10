import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function frame(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `OGX1:meta-prompt-test:1:1:${encoded}:END`;
}

async function waitFor(child: ChildProcessWithoutNullStreams, output: () => string, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`bridge did not print '${expected}':\n${output()}`)), 7_000);
    const interval = setInterval(() => {
      if (!output().includes(expected)) return;
      clearTimeout(timeout);
      clearInterval(interval);
      resolve();
    }, 10);
    child.once("error", reject);
  });
}

const META_RESULT = `# 역할
Prompt architect
# 목표
Create an executable prompt.
# 작업 컨텍스트
## 확인된 사실
The human asked for a release check.
## 가정
None.
## 미확인 사항
None.
# 요구사항
Preserve intent.
# 제약사항
Do not invent facts.
# 실행 절차
1. Inspect inputs.
# 출력 형식
Return a report.
# 품질 기준
All claims are grounded.
# 입력
Use the supplied release scope.`;

const META_RESULT_WITH_PROJECT = META_RESULT.replace(
  "# 요구사항",
  "## 대상 프로젝트\n- release-project: `/portable/release-project` · branch `feature/release`\n\n# 요구사항",
);

async function installFakeOrca(directory: string, malformed = false): Promise<{ command: string; log: string }> {
  const command = path.join(directory, "fake-orca.mjs");
  const log = path.join(directory, "orca-calls.jsonl");
  await writeFile(command, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.ORCA_GRAPH_FAKE_CALL_LOG, JSON.stringify(args) + "\\n");
let result = {};
if (args[0] === "terminal" && args[1] === "show") {
  const handle = args[args.indexOf("--terminal") + 1];
  result = { terminal: handle === "bridge-terminal"
    ? { handle, worktreeId: "fake-worktree", tabId: "bridge-tab", leafId: "bridge-leaf" }
    : { handle, worktreeId: "fake-worktree", tabId: "meta-tab", leafId: "meta-leaf" } };
} else if (args[0] === "terminal" && args[1] === "create") {
  result = { terminal: { handle: "meta-terminal" } };
} else if (args[0] === "terminal" && args[1] === "wait") {
  result = { wait: { satisfied: true } };
} else if (args[0] === "terminal" && args[1] === "send") {
  result = { terminal: { handle: "meta-terminal" } };
} else if (args[0] === "worktree" && args[1] === "ps") {
  result = { worktrees: [{ worktreeId: "fake-worktree", agents: [{
    paneKey: "meta-tab:meta-leaf", agentType: "codex", state: "done",
    lastAssistantMessage: ${JSON.stringify(malformed ? "not a valid prompt" : META_RESULT)},
  }] }] };
}
process.stdout.write(JSON.stringify({ ok: true, result }));
`, { mode: 0o755 });
  await writeFile(path.join(directory, "targets.json"), `${JSON.stringify({
    refreshedAt: "2026-08-09T00:00:00.000Z",
    projects: [],
    sessions: [],
    models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol", agent: "codex", reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"] }],
  })}\n`);
  return { command, log };
}

function storeFixture() {
  const now = "2026-08-09T00:00:00.000Z";
  return {
    schemaVersion: 1,
    activeGraphId: "graph-1",
    bridgeTerminalId: "bridge-terminal",
    domains: [{
      id: "domain-1", name: "Product", summary: "Product scope", objectives: "Ship safely", commonNotes: "", constraintNotes: "No downtime",
      status: "active", owners: [], version: 1, createdAt: now, updatedAt: now,
    }],
    milestones: [{
      id: "milestone-1", domainId: "domain-1", name: "Release", summary: "", objectives: "Launch", commonNotes: "", constraintNotes: "",
      status: "active", priority: "high", successCriteria: ["Checks pass"], owners: [], version: 1, createdAt: now, updatedAt: now,
    }],
    tasks: [{
      id: "task-1", title: "Release check", prompt: "Check the release", domainId: "domain-1", milestoneId: "milestone-1",
      projects: [{
        id: "project-link-1", role: "target", locatorKind: "folder", locator: "/portable/release-project",
        label: "release-project", branch: "feature/release", position: 0,
      }],
      draft: "Check the release", promptRevisions: [{
        id: "draft-1", kind: "draft", revision: 1, content: "Check the release", status: "current", generator: "human", createdAt: now,
      }],
      metaPromptRun: { status: "running", requestedAt: now, draftRevisionId: "draft-1" },
      status: "ready", priority: "high", tags: ["release"], createdAt: now, updatedAt: now,
    }],
    todos: [],
    graphs: [{
      id: "graph-1", name: "Release graph", summary: "", status: "draft", version: 1, pinned: false, processEnabled: false, routineEnabled: false,
      repeatMode: "none", defaults: {}, runGuards: {}, nodes: [{
        id: "node-1", kind: "task", label: "Release check", x: 0, y: 0, status: "pending", joinMode: "all",
        task: { id: "task-1", title: "Release check", prompt: "Check the release" },
      }], edges: [], runs: [], createdAt: now, updatedAt: now,
    }],
  };
}

async function runBridge(directory: string, malformed = false): Promise<{ output: string; calls: string[][] }> {
  const fixture = storeFixture();
  await writeFile(path.join(directory, "store.json"), `${JSON.stringify(fixture)}\n`);
  const fake = await installFakeOrca(directory, malformed);
  const child = spawn(process.execPath, [path.join(process.cwd(), "bridge/index.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ORCA_GRAPH_RUNTIME_DIR: directory,
      ORCA_GRAPH_SKIP_REBUILD: "1",
      ORCA_CLI_COMMAND: fake.command,
      ORCA_GRAPH_FAKE_CALL_LOG: fake.log,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitFor(child, () => output, "bridge ready");
    child.stdin.write(frame({ type: "meta-prompt", itemKind: "task", itemId: "task-1", draftRevisionId: "draft-1" }));
    await waitFor(child, () => output, malformed ? "missing ordered heading" : "Meta Prompt generated");
    child.stdin.end();
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
  } finally {
    if (child.exitCode === null) child.kill();
  }
  const calls = (await readFile(fake.log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { output, calls };
}

describe("Meta Prompt bridge", () => {
  it("uses the built-in contract in a fresh Orca agent and saves a lineage-linked Meta Draft", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-meta-prompt-"));
    temporaryDirectories.push(directory);
    const { calls } = await runBridge(directory);
    const store = JSON.parse(await readFile(path.join(directory, "store.json"), "utf8"));
    const task = store.tasks[0];
    expect(task.metaDraft).toBe(META_RESULT_WITH_PROJECT);
    expect(task.prompt).toBe(META_RESULT_WITH_PROJECT);
    expect(task.metaPromptRun).toBeUndefined();
    expect(task.promptRevisions.at(-1)).toMatchObject({
      kind: "meta", status: "current", basedOnId: "draft-1", generator: "meta-prompt-agent",
    });
    expect(store.graphs[0].nodes[0].task.prompt).toBe(META_RESULT_WITH_PROJECT);
    const create = calls.find((args) => args[0] === "terminal" && args[1] === "create");
    expect(create?.join(" ")).toContain("codex --model 'gpt-5.6-sol' -c model_reasoning_effort='medium'");
    const send = calls.find((args) => args[0] === "terminal" && args[1] === "send");
    expect(send?.join("\n")).toContain("다음 9개 H1 섹션만 정확한 순서로 출력하십시오");
    expect(send?.join("\n")).toContain("# 역할");
    expect(send?.join("\n")).toContain('"content":"Check the release"');
    expect(send?.join("\n")).toContain('"domain":{"id":"domain-1","name":"Product"');
    expect(send?.join("\n")).toContain('"locator":"/portable/release-project"');
    expect(send?.join("\n")).toContain("role='target'");
    expect((task.metaDraft.match(/^# /gmu) ?? [])).toHaveLength(9);
  });

  it("keeps the human Draft and records failure when the agent output violates the fixed section contract", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-meta-prompt-invalid-"));
    temporaryDirectories.push(directory);
    await runBridge(directory, true);
    const store = JSON.parse(await readFile(path.join(directory, "store.json"), "utf8"));
    expect(store.tasks[0].draft).toBe("Check the release");
    expect(store.tasks[0].metaDraft).toBeUndefined();
    expect(store.tasks[0].metaPromptRun).toMatchObject({ status: "failed", draftRevisionId: "draft-1" });
    expect(store.tasks[0].metaPromptRun.error).toContain("missing ordered heading");
  });
});
