import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * 실행은 이 플러그인이 밖으로 나가는 마지막 한 걸음이다. 여기서 쓰는 것은 공개
 * `orca` CLI의 계약이고, 플래그 하나만 어긋나도 세션은 만들어지지만 프롬프트는
 * 들어가지 않는다 — 사용자에게는 "실행이 안 된다"로만 보인다. 그래서 진짜 Orca
 * 대신 계약을 그대로 흉내 내는 CLI를 세워, 실제로 프로세스를 띄워 확인한다.
 */

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((task) => task()));
});

/** 진짜 CLI처럼 모르는 플래그를 거절하는 가짜 orca. 관대하면 계약 파손을 놓친다. */
const FAKE_ORCA = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(argv) + "\\n");

const VALID = {
  "terminal list": ["--worktree", "--limit", "--environment", "--json"],
  "worktree ps": ["--limit", "--environment", "--json"],
  "terminal read": ["--terminal", "--environment", "--json"],
  "terminal show": ["--terminal", "--environment", "--json"],
  "terminal send": ["--terminal", "--text", "--enter", "--interrupt", "--environment", "--json"],
  "terminal create": ["--worktree", "--title", "--command", "--focus", "--environment", "--json"],
  "terminal wait": ["--terminal", "--for", "--timeout-ms", "--environment", "--json"],
};

function fail(message, code) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: code ?? "invalid_argument", message } }));
  process.exit(0);
}

const command = argv.slice(0, 2).join(" ");
const valid = VALID[command];
if (!valid) fail("unknown command: " + command, "unknown_command");
for (const argument of argv.slice(2)) {
  if (argument.startsWith("--") && !valid.includes(argument)) {
    fail("Unknown flag " + argument + " for command: " + command);
  }
}
if (command === "terminal wait" && process.env.FAKE_ORCA_WAIT_TIMES_OUT === "1") fail("timed_out", "timed_out");

const result = command === "worktree ps"
  ? { worktrees: [{ worktreeId: "repo::/active", isActive: true, isArchived: false }] }
  : command === "terminal list"
  ? { terminals: JSON.parse(process.env.FAKE_ORCA_TERMINALS || "[]") }
  : command === "terminal read"
  ? { terminal: { tail: ["error: the argument '--ask-for-approval' cannot be used with '--dangerously-bypass-approvals-and-sandbox'"] } }
  : command === "terminal create"
  ? { terminal: { handle: "term_created", paneKey: "tab:leaf" } }
  : command === "terminal show"
    ? { terminal: {
        handle: argv[argv.indexOf("--terminal") + 1], title: "기존 세션",
        connected: process.env.FAKE_ORCA_AGENT_DIES !== "1",
        writable: process.env.FAKE_ORCA_AGENT_DIES !== "1",
        lastOutputAt: 1,
      } }
    : {};
process.stdout.write(JSON.stringify({ ok: true, result }));
`;

type FakeOrca = { calls: () => Promise<string[][]> };

async function fakeOrca(): Promise<FakeOrca> {
  const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-dispatch-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const commandPath = path.join(directory, "fake-orca.mjs");
  const logPath = path.join(directory, "calls.jsonl");
  await writeFile(commandPath, FAKE_ORCA, "utf8");
  await chmod(commandPath, 0o755);
  await writeFile(logPath, "", "utf8");
  process.env.ORCA_CLI_COMMAND = commandPath;
  process.env.FAKE_ORCA_LOG = logPath;
  cleanup.push(async () => {
    delete process.env.ORCA_CLI_COMMAND;
    delete process.env.FAKE_ORCA_LOG;
    delete process.env.FAKE_ORCA_WAIT_TIMES_OUT;
    delete process.env.FAKE_ORCA_TERMINALS;
    delete process.env.FAKE_ORCA_AGENT_DIES;
  });
  return {
    calls: async () => (await readFile(logPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)),
  };
}

/** `orca` 호출 방식은 모듈을 읽을 때 정해진다. 가짜 CLI를 세운 뒤에 다시 읽는다. */
async function loadDispatch() {
  vi.resetModules();
  return import("../lib/dispatch.mjs");
}

describe("dispatch · Orca CLI 계약", () => {
  it("새 세션을 만들고 TUI가 준비된 뒤에 프롬프트를 넣는다", async () => {
    const orca = await fakeOrca();
    const { dispatchTarget } = await loadDispatch();

    const result = await dispatchTarget({
      label: "Graph",
      worktreeId: "repo::/tmp/project",
      title: "GE · Graph",
      modelDefinition: { id: "gpt-5.6-sol", agent: "codex" },
      reasoning: "high",
    }, "프롬프트");

    expect(result.opened).toBe("new-session");
    expect(result.sessionId).toBe("term_created");

    const calls = await orca.calls();
    // 만들고 → 준비를 기다리고 → 살아 있는지 보고 → 넣고 → 화면이 멎길 기다렸다 제출.
    // 조용해질 때까지의 폴링 횟수는 화면에 달렸으므로 순서만 본다.
    const sequence = calls.map((call) => call.slice(0, 2).join(" "));
    expect(sequence.slice(0, 3)).toEqual(["terminal create", "terminal wait", "terminal show"]);
    expect(sequence.filter((name) => name === "terminal send")).toHaveLength(2);
    expect(sequence.at(-1)).toBe("terminal send");
    // `exec`로 띄워야 에이전트가 죽을 때 셸이 남지 않는다.
    expect(calls[0]?.[calls[0].indexOf("--command") + 1]).toMatch(/^exec codex /u);

    // 대기는 밀리초 단위 플래그를 받는다. 초 단위 `--timeout`은 거절당해, 세션만
    // 만들어 두고 프롬프트는 영영 들어가지 않는다.
    const wait = calls[1] ?? [];
    expect(wait).toContain("--timeout-ms");
    expect(wait).not.toContain("--timeout");
    expect(Number(wait[wait.indexOf("--timeout-ms") + 1])).toBeGreaterThanOrEqual(30_000);

    // 텍스트와 Enter를 한 번에 보내면 TUI가 붙여넣기로 보고 Enter를 줄바꿈으로 넣는다.
    // 여러 줄 프롬프트는 항상 그렇게 되어, 입력창에 글만 남고 실행되지 않는다.
    expect(calls[3]).toEqual(expect.arrayContaining(["--terminal", "term_created", "--text", "프롬프트"]));
    expect(calls[3]).not.toContain("--enter");
    expect(calls.slice(4).some((call) => call.slice(0, 2).join(" ") === "terminal show")).toBe(true);
    const sends = calls.filter((call) => call.slice(0, 2).join(" ") === "terminal send");
    expect(sends[1]).toEqual(expect.arrayContaining(["--terminal", "term_created", "--enter"]));
    expect(sends[1]).not.toContain("--text");
  });

  it("준비 신호가 없어도 세션이 살아 있으면 보내고 그 사실을 남긴다", async () => {
    const orca = await fakeOrca();
    process.env.FAKE_ORCA_WAIT_TIMES_OUT = "1";
    const { dispatchWorkItem } = await loadDispatch();

    const record = await dispatchWorkItem({
      itemKind: "graph", itemId: "graph-a", title: "Graph", prompt: "프롬프트",
      executionMode: "single_session",
      targets: [{
        label: "Graph", worktreeId: "repo::/tmp/project",
        modelDefinition: { id: "claude-opus-5", agent: "claude" },
      }],
    });

    // 준비 전에 보낸 입력은 삼켜지므로 보내지 않는다. 대신 만들어 둔 세션을 알린다.
    // `tui-idle`은 UI가 pane을 받아들였을 때만 오는 신호다. 백그라운드 handle로 열린
    // 세션에서는 영영 오지 않으므로, 살아 있으면 보내고 확인 없이 보냈다고 남긴다.
    const names = (await orca.calls()).map((call) => call.slice(0, 2).join(" "));
    expect(names.slice(0, 4)).toEqual(["terminal create", "terminal wait", "terminal show", "terminal send"]);
    expect(names.filter((name) => name === "terminal send")).toHaveLength(2);
    expect(record.targets).toHaveLength(1);
    expect(record.targets[0]?.readyConfirmed).toBe(false);
    expect(record.error).toBeUndefined();
  });

  it("승인 프롬프트 없이 세션을 띄우고, 끄면 그 플래그를 빼고 띄운다", async () => {
    const orca = await fakeOrca();
    const { dispatchTarget } = await loadDispatch();

    await dispatchTarget({
      label: "Claude", worktreeId: "repo::/tmp/project",
      modelDefinition: { id: "claude-opus-5", agent: "claude" },
    }, "프롬프트");
    await dispatchTarget({
      label: "Codex", worktreeId: "repo::/tmp/project", reasoning: "high",
      modelDefinition: { id: "gpt-5.6-sol", agent: "codex" },
    }, "프롬프트");
    await dispatchTarget({
      label: "손으로 볼 세션", worktreeId: "repo::/tmp/project", autoApprove: false,
      modelDefinition: { id: "claude-opus-5", agent: "claude" },
    }, "프롬프트");

    const commands = (await orca.calls())
      .filter((call) => call.slice(0, 2).join(" ") === "terminal create")
      // 실제로 보내는 값은 `exec ` + 에이전트 명령이다. 여기서는 명령만 본다.
      .map((call) => String(call[call.indexOf("--command") + 1]).replace(/^exec /u, ""));
    // 사람이 지켜보지 않는 세션이 승인 프롬프트에서 멈추면 원격 실행이 성립하지 않는다.
    expect(commands[0]).toBe("claude --model 'claude-opus-5' --permission-mode bypassPermissions");
    // `-a`를 함께 주면 codex가 "cannot be used with"로 거절하고 즉시 죽는다.
    expect(commands[1]).toBe("codex --model 'gpt-5.6-sol' -c model_reasoning_effort='high' --dangerously-bypass-approvals-and-sandbox");
    expect(commands[1]).not.toContain("-a never");
    expect(commands[2]).toBe("claude --model 'claude-opus-5'");
  });

  it("에이전트가 뜨지 않으면 프롬프트를 셸에 타이핑하지 않는다", async () => {
    const orca = await fakeOrca();
    process.env.FAKE_ORCA_AGENT_DIES = "1";
    const { dispatchWorkItem } = await loadDispatch();

    const record = await dispatchWorkItem({
      itemKind: "task", itemId: "task-a", title: "Task", prompt: "프롬프트",
      executionMode: "single_session",
      targets: [{
        label: "API", worktreeId: "repo::/tmp/project",
        modelDefinition: { id: "gpt-5.6-sol", agent: "codex" },
      }],
    });

    // 명령이 즉시 죽으면 터미널도 함께 죽는다. 그 상태를 확인하고 멈춰야 한다.
    expect((await orca.calls()).some((call) => call.slice(0, 2).join(" ") === "terminal send")).toBe(false);
    expect(record.targets).toHaveLength(0);
    expect(record.error).toContain("에이전트가 뜨지 않아");
    // 왜 죽었는지 화면에 적혀 있다. 그것을 그대로 옮긴다.
    expect(record.error).toContain("cannot be used with");
  });

  it("기존 세션에는 새 세션을 만들지 않고 그대로 넣는다", async () => {
    const orca = await fakeOrca();
    const { dispatchTarget } = await loadDispatch();

    const result = await dispatchTarget({ label: "Task", sessionId: "term_live" }, "프롬프트");

    expect(result.opened).toBe("existing-session");
    const existing = (await orca.calls()).map((call) => call.slice(0, 2).join(" "));
    expect(existing[0]).toBe("terminal show");
    expect(existing.filter((name) => name === "terminal send")).toHaveLength(2);
    expect(existing.at(-1)).toBe("terminal send");
  });
});

describe("전용 터미널", () => {
  /** `orca` 호출 방식은 모듈을 읽을 때 정해진다. 가짜 CLI를 세운 뒤에 다시 읽는다. */
  const loadOrca = async () => {
    vi.resetModules();
    return import("../lib/orca.mjs");
  };

  it("이미 열려 있으면 다시 만들지 않고 그 터미널을 쓴다", async () => {
    const orca = await fakeOrca();
    process.env.FAKE_ORCA_TERMINALS = JSON.stringify([
      { handle: "term_other", title: "◐ 다른 작업", connected: true, writable: true },
      { handle: "term_plugin", title: "Graph Engineering", connected: true, writable: true },
    ]);
    const { ensureSaveTerminal } = await loadOrca();

    expect(await ensureSaveTerminal()).toBe("term_plugin");
    // 저장할 때마다 탭이 하나씩 늘어나면 아무도 그 워크트리를 못 쓴다.
    expect((await orca.calls()).map((call) => call.slice(0, 2).join(" "))).toEqual(["worktree ps", "terminal list"]);
  });

  it("없으면 이름 붙은 터미널을 하나 만든다", async () => {
    const orca = await fakeOrca();
    process.env.FAKE_ORCA_TERMINALS = JSON.stringify([
      { handle: "term_other", title: "◐ 다른 작업", connected: true, writable: true },
    ]);
    const { ensureSaveTerminal } = await loadOrca();

    expect(await ensureSaveTerminal()).toBe("term_created");
    const created = (await orca.calls()).find((call) => call.slice(0, 2).join(" ") === "terminal create") ?? [];
    // 활성 워크트리를 id로 찍어야 한다. `active`는 현재 디렉터리로 푸는데, 이 CLI는
    // 보통 Orca 워크트리 밖(플러그인 설치 경로)에서 돈다.
    expect(created).toEqual(expect.arrayContaining(["--title", "Graph Engineering", "--worktree", "id:repo::/active"]));
    // 셸이어야 한다. 에이전트를 띄우면 그 터미널이 작업을 받는 쪽이 된다.
    expect(created).not.toContain("--command");
  });

  it("Orca에 닿지 못해도 저장을 막지 않는다", async () => {
    await fakeOrca();
    process.env.ORCA_CLI_COMMAND = "/nonexistent/orca";
    const { ensureSaveTerminal } = await loadOrca();

    expect(await ensureSaveTerminal()).toBeNull();
  });
});
