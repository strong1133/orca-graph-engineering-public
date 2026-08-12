import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { JSDOM, type DOMWindow } from "jsdom";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

type HostRequest = { action: string; params?: Record<string, any> };

/**
 * 패널이 밖으로 나가는 유일한 통로인 `terminal.sendText`를 잡아, 실제로 어떤 명령이
 * 터미널로 나갔는지 확인할 수 있게 한다. 긴 명령은 여러 번에 나눠 보내고 마지막에만
 * Enter가 붙으므로, Enter를 기준으로 한 줄로 다시 합친다.
 */
function terminalHost(terminals: Array<{ id: string }> = [{ id: "shell" }], displayName = "current-project") {
  const requests: HostRequest[] = [];
  const commands: string[] = [];
  let buffer = "";
  const configure = (window: DOMWindow): void => {
    window.addEventListener("message", (event) => {
      const request = event.data as { type?: string; requestId?: string; action?: string; params?: Record<string, any> } | null;
      if (request?.type !== "orca-panel-action" || !request.requestId || !request.action) return;
      requests.push({ action: request.action, ...(request.params ? { params: request.params } : {}) });
      if (request.action === "terminal.sendText") {
        // 명령 앞의 줄 지우기 제어문자는 명령 본문이 아니다.
        buffer += String(request.params?.text ?? "").replaceAll("\u0015", "");
        if (request.params?.enter) {
          commands.push(buffer);
          buffer = "";
        }
      }
      const value = request.action === "workspace.readContext"
        ? { branch: "refs/heads/main", displayName, terminals }
        : undefined;
      window.postMessage({ type: "orca-panel-action-result", requestId: request.requestId, ok: true, value }, "*");
    });
  };
  return { requests, commands, configure };
}

/**
 * 저장 CLI 명령 한 줄을 하위 명령들과 원래 payload로 되돌린다.
 *
 * 한 줄에 `&&`로 여러 명령이 묶여 올 수 있다. 앞 명령이 도는 동안 다음 줄을
 * 타이핑하면 tty 버퍼에서 잘리므로, 패널은 이어질 명령을 한 줄로 보낸다.
 */
function decodeCommands(line: string): Array<{ command: string; payload?: any }> {
  return line.trim().split(" && ").map((part) => {
    const match = /graph-store\.mjs" (save|dispatch|source|refresh)(?: ([A-Za-z0-9_-]+))?$/u.exec(part.trim());
    if (!match) throw new Error(`not a graph-store command: ${part}`);
    return {
      command: match[1]!,
      ...(match[2] ? { payload: JSON.parse(gunzipSync(Buffer.from(match[2], "base64url")).toString("utf8")) } : {}),
    };
  });
}

function decodeCommand(line: string): { command: string; payload?: any } {
  return decodeCommands(line)[0]!;
}

/**
 * 패널의 터미널 왕복은 postMessage 여러 번을 거친다. 고정된 tick 수로 기다리면
 * 부하에 따라 마지막 명령을 놓쳐 테스트가 간헐적으로 깨진다.
 */
async function settle(dom: JSDOM, expectedCommands?: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (let index = 0; index < 200; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (expectedCommands === undefined) {
      if (index >= 30) return;
      continue;
    }
    if (Date.now() > deadline) return;
  }
  void dom;
}

async function waitForCommands(host: { commands: string[] }, count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (host.commands.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const root = process.cwd();
const execFileAsync = promisify(execFile);
let productionPanelHtml: Promise<string> | null = null;

function configureWindow(): (window: DOMWindow) => void {
  return (window) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "structuredClone", { configurable: true, value: structuredClone });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe(): void {}
        disconnect(): void {}
      },
    });
    // 패널은 저장 payload를 gzip+base64url로 만든다. jsdom에는 이 세 가지가 없어
    // Node 전역을 그대로 넣어 준다 — 세 개를 함께 넣어야 서로 호환된다.
    Object.defineProperty(window, "CompressionStream", { configurable: true, value: CompressionStream });
    Object.defineProperty(window, "Blob", { configurable: true, value: Blob });
    Object.defineProperty(window, "Response", { configurable: true, value: Response });
    Object.defineProperty(window, "TextEncoder", { configurable: true, value: TextEncoder });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    // 결정적이되 호출마다 달라야 한다. 같은 값을 계속 돌려주면 동시에 뜬 host call의
    // requestId가 겹쳐 응답이 엉뚱한 호출로 간다.
    let uuidSequence = 0;
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        uuidSequence += 1;
        return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
      },
    });
  };
}

function panelBootstrapScript(value: unknown): string {
  const encoded = JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<script id="orca-graph-bootstrap" type="application/json">${encoded}</script>`;
}

async function mountPanel(
  configure?: (bootstrap: { store: Record<string, any>; targets: Record<string, any> }) => void,
  configureDom?: (window: DOMWindow) => void,
): Promise<JSDOM> {
  const [store, targets] = await Promise.all([
    readFile(path.join(root, "fixtures/default-store.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "fixtures/default-targets.json"), "utf8").then(JSON.parse),
  ]);
  const bootstrap = {
    store,
    targets,
    pluginRoot: ".",
    builtAt: "2026-08-09T00:00:00.000Z",
  };
  configure?.(bootstrap);
  const result = await build({
    entryPoints: [path.join(root, "src/panel.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
  });
  const javascript = result.outputFiles[0]?.text;
  if (!javascript) throw new Error("panel test bundle was not generated");
  const dom = new JSDOM(`<!doctype html>${panelBootstrapScript(bootstrap)}<main id="app"></main><script>${javascript.replaceAll("</script", "<\\/script")}</script>`, {
    runScripts: "dangerously",
    url: "http://127.0.0.1/panel",
    beforeParse: (window) => {
      configureWindow()(window);
      configureDom?.(window);
    },
  });
  await Promise.resolve();
  return dom;
}

async function mountProductionPanel(): Promise<JSDOM> {
  productionPanelHtml ??= (async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "orca-graph-panel-dist-"));
    const output = path.join(directory, "panel.html");
    try {
      await execFileAsync(process.execPath, [path.join(root, "scripts/build.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          ORCA_GRAPH_BUILD_OUTPUT: output,
          ORCA_GRAPH_BUILD_FIXTURES_ONLY: "1",
          ORCA_GRAPH_PLUGIN_ROOT: ".",
          SOURCE_DATE_EPOCH: "0",
        },
      });
      return await readFile(output, "utf8");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  const dom = new JSDOM(await productionPanelHtml, {
    runScripts: "dangerously",
    url: "http://127.0.0.1/panel",
    beforeParse: configureWindow(),
  });
  await Promise.resolve();
  return dom;
}

function key(dom: JSDOM, element: Element, value: string, shiftKey = false): void {
  element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));
}

function focusables(dialog: Element): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )];
}


it("saves through the plugin's own terminal without asking, and never through an agent pane", async () => {
  // 이 플러그인은 자기 전용 터미널을 쓴다. CLI가 확보해 두고 handle이 store에
  // 남으므로, 패널은 어느 터미널로 보낼지 묻지 않는다.
  const host = terminalHost([{ id: "term_agent" }, { id: "term_plugin" }]);
  const dom = await mountPanel(({ store, targets }) => {
    store.saveTerminalId = "term_plugin";
    targets.sessions = [{
      id: "term_agent", title: "◐ 다른 작업", environmentId: "local", worktreeId: "wt-current",
      projectId: "project-current", paneKey: "tab:leaf", agentType: "claude",
      agentState: "working", connected: true, writable: true,
    }];
  }, host.configure);
  try {
    const { document } = dom.window;
    document.querySelector<HTMLButtonElement>('[data-action="add-task"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    await settle(dom);
    await waitForCommands(host, 1);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.commands).toHaveLength(1);
    expect(decodeCommand(host.commands[0]!).command).toBe("save");
    expect(host.requests.filter((request) => request.action === "terminal.sendText")
      .every((request) => request.params?.terminalId === "term_plugin")).toBe(true);
  } finally {
    dom.window.close();
  }
});

it("falls back to a shell once where the plugin has no terminal yet", async () => {
  // 전용 터미널이 아직 없는 워크트리다. 기억해 둔 handle은 여기 없으므로 에이전트가
  // 아닌 터미널로 한 번 보낸다 — 그 명령이 이 워크트리의 전용 터미널을 만든다.
  const host = terminalHost([{ id: "term_agent" }, { id: "term_shell" }]);
  const dom = await mountPanel(({ store, targets }) => {
    store.saveTerminalId = "term_from_another_worktree";
    targets.sessions = [{
      id: "term_agent", title: "◐ 다른 작업", environmentId: "local", worktreeId: "wt-current",
      projectId: "project-current", paneKey: "tab:leaf", agentType: "claude",
      agentState: "working", connected: true, writable: true,
    }];
  }, host.configure);
  try {
    const { document } = dom.window;
    document.querySelector<HTMLButtonElement>('[data-action="add-task"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    await settle(dom);
    await waitForCommands(host, 1);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.commands).toHaveLength(1);
    expect(host.requests.filter((request) => request.action === "terminal.sendText")
      .every((request) => request.params?.terminalId === "term_shell")).toBe(true);
  } finally {
    dom.window.close();
  }
});

it("holds the command and sends it as soon as a terminal appears", async () => {
  // 패널은 터미널을 만들 수 없다(호스트가 sandbox 패널에 여는 액션은 세 개뿐).
  // 그렇다고 편집을 버리면 사용자는 저장을 다시 눌러야 한다는 것도 모른 채 잃는다.
  const terminals: Array<{ id: string }> = [];
  const host = terminalHost(terminals);
  const dom = await mountPanel(undefined, host.configure);
  try {
    const { document } = dom.window;
    document.querySelector<HTMLButtonElement>('[data-action="add-task"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    await settle(dom);

    expect(host.commands).toEqual([]);
    expect(document.querySelector(".toast")?.textContent).toContain("자동으로 이어서 보냅니다");
    // 패널이 안 보고 있어도 알 수 있게 Orca 알림도 띄운다.
    expect(host.requests.some((request) => request.action === "notifications.show")).toBe(true);

    // 사용자가 터미널 탭을 하나 열면 그 뒤는 저절로 간다.
    terminals.push({ id: "term_opened" });
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await waitForCommands(host, 1);

    expect(host.commands).toHaveLength(1);
    expect(decodeCommand(host.commands[0]!).command).toBe("save");
    expect(host.requests.filter((request) => request.action === "terminal.sendText")
      .every((request) => request.params?.terminalId === "term_opened")).toBe(true);
  } finally {
    dom.window.close();
  }
});

it("sends nothing when only agent panes are open", async () => {
  // 에이전트가 도는 pane에 저장 명령을 넣으면 셸이 아니라 그 에이전트의 입력이
  // 된다. 저장도 실행도 일어나지 않고, 사용자에게는 아무 일도 안 한 것으로 보인다.
  const host = terminalHost([{ id: "term_agent" }]);
  const dom = await mountPanel(({ targets }) => {
    targets.sessions = [{
      id: "term_agent", title: "◐ 다른 작업", environmentId: "local", worktreeId: "wt-current",
      projectId: "project-current", paneKey: "tab:leaf", agentType: "claude",
      agentState: "working", connected: true, writable: true,
    }];
  }, host.configure);
  try {
    const { document } = dom.window;
    document.querySelector<HTMLButtonElement>('[data-action="add-task"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    await settle(dom);

    expect(host.commands).toEqual([]);
    expect(document.querySelector(".toast")?.textContent).toContain("에이전트 세션만");
  } finally {
    dom.window.close();
  }
});

describe("panel accessibility", () => {
  it("manages local Tasks and Todos without a connected data source", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event } = dom.window;
      expect(document.querySelector<HTMLButtonElement>('.topbar [data-action="refresh-source"]')?.disabled).toBe(true);
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("요구사항 설계");

      document.querySelector<HTMLButtonElement>('[data-action="new-local-task"]')?.click();
      const title = document.querySelector<HTMLInputElement>('[data-scope="local-task"][data-field="title"]');
      expect(title).not.toBeNull();
      if (title) {
        title.value = "독립 로컬 Task";
        title.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="add-local-task-node"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      expect([...document.querySelectorAll(".node-title")].some((item) => item.textContent === "독립 로컬 Task")).toBe(true);

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-local-todo"]')?.click();
      const todoTitle = document.querySelector<HTMLInputElement>('[data-scope="local-todo"][data-field="title"]');
      if (todoTitle) {
        todoTitle.value = "검수 Todo";
        todoTitle.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="create-task-for-todo"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.querySelector('[aria-label="Task 상세"]')).not.toBeNull();
      expect(document.querySelector('[aria-label="Task 관리"]')).toBeNull();
      document.querySelector<HTMLButtonElement>('[data-action="back-to-task-list"]')?.click();
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("검수 Todo");
      expect(document.querySelector('.topbar [role="status"]')?.textContent).toContain("저장 안 됨");
    } finally {
      dom.window.close();
    }
  });

  it("creates an ordered quick graph from Tasks in the same Domain and Milestone", async () => {
    const now = "2026-08-10T00:00:00.000Z";
    const task = (id: string, title: string, milestoneId = "milestone-a", status = "ready") => ({
      id, title, prompt: `Prompt ${title}`, draft: `Prompt ${title}`, promptRevisions: [],
      domainId: "domain-a", milestoneId, status, priority: "medium", tags: [], createdAt: now, updatedAt: now,
    });
    const dom = await mountPanel(({ store }) => {
      store.domains = [{
        id: "domain-a", name: "Delivery", summary: "", objectives: "", commonNotes: "", constraintNotes: "",
        status: "active", owners: [], version: 1, createdAt: now, updatedAt: now,
      }];
      store.milestones = [
        { id: "milestone-a", domainId: "domain-a", name: "Release A", summary: "", objectives: "", commonNotes: "", constraintNotes: "", status: "active", priority: "medium", successCriteria: [], owners: [], version: 1, createdAt: now, updatedAt: now },
        { id: "milestone-b", domainId: "domain-a", name: "Release B", summary: "", objectives: "", commonNotes: "", constraintNotes: "", status: "active", priority: "medium", successCriteria: [], owners: [], version: 1, createdAt: now, updatedAt: now },
      ];
      store.tasks = [
        task("task-source", "시작 Task"), task("task-second", "두 번째 Task"), task("task-third", "세 번째 Task"),
        task("task-other", "다른 범위 Task", "milestone-b"), task("task-archived", "보관 Task", "milestone-a", "archived"),
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-source"]')?.click();
      const opener = document.querySelector<HTMLButtonElement>('[data-action="open-quick-graph"]');
      expect(opener?.textContent).toContain("빠른 그래프 구성");
      opener?.click();

      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("현재 Task를 1번으로 고정");
      expect(dialog?.querySelectorAll('[role="option"]')).toHaveLength(3);
      expect(dialog?.textContent).not.toContain("다른 범위 Task");
      expect(dialog?.textContent).not.toContain("보관 Task");
      dialog?.querySelector<HTMLButtonElement>('[data-action="toggle-quick-graph-task"][data-id="task-second"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      dialog?.querySelector<HTMLButtonElement>('[data-action="toggle-quick-graph-task"][data-id="task-third"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      dialog?.querySelector<HTMLButtonElement>('[data-action="move-quick-graph-task"][data-id="task-third"][data-delta="-1"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect([...dialog?.querySelectorAll(".quick-graph-order-title") ?? []].map((item) => item.textContent)).toEqual([
        "시작 Task", "세 번째 Task", "두 번째 Task",
      ]);
      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-quick-graph"]')?.click();

      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect([...document.querySelectorAll(".node-title")].map((item) => item.textContent)).toEqual([
        "1. 시작 Task", "2. 세 번째 Task", "3. 두 번째 Task",
      ]);
      expect(document.querySelectorAll("g[data-edge-id]")).toHaveLength(2);
      expect(document.querySelector<HTMLSelectElement>(".graph-switcher")?.selectedOptions[0]?.textContent).toContain("시작 Task · 빠른 흐름");
    } finally {
      dom.window.close();
    }
  });

  it("opens a standalone Task run dialog with one-off Orca routing", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      targets.environments = [
        { id: "local", name: "device-a", local: true, connected: true },
        { id: "environment-device-b", name: "device-b", local: false, connected: true },
      ];
      targets.projects = [
        { id: "repo:current-project", name: "current-project", environmentId: "local", worktreeId: "worktree-current-project", current: true },
        { id: "repo:remote-project", name: "remote-project", environmentId: "environment-device-b", worktreeId: "worktree-remote-project" },
      ];
      targets.sessions = [{
        id: "remote-session", title: "Remote Codex", environmentId: "environment-device-b",
        worktreeId: "worktree-remote-project", projectId: "repo:remote-project", paneKey: "tab:leaf",
        agentType: "codex", agentState: "done", connected: true, writable: true,
      }];
    });
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();

      const detail = document.querySelector<HTMLElement>('[aria-label="Task 상세"]');
      const opener = detail?.querySelector<HTMLButtonElement>('[data-action="open-task-run"]');
      expect(opener?.textContent).toContain("실행");
      opener?.click();

      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Task 실행");
      expect(dialog?.textContent).toContain("실행 머신과 배정 방식");
      expect(dialog?.textContent).toContain("현재 프로젝트 추천");
      const environment = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="environmentId"]');
      expect(environment?.value).toBe("local");
      expect([...(environment?.options ?? [])].map((option) => option.textContent)).toEqual(["device-a · 이 Orca", "device-b"]);
      expect(dialog?.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="repo:current-project"]')?.checked).toBe(true);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]')?.value).toBe("gpt-5.6-sol");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);

      const model = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]');
      if (model) {
        model.value = "claude-opus-5";
        model.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Claude Opus 5");
      expect(dialog?.querySelector('[data-scope="task-run-routing"][data-field="reasoning"]')).toBeNull();
      expect(dialog?.textContent).not.toContain("Reasoning");

      const rerenderedEnvironment = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="environmentId"]');
      if (rerenderedEnvironment) {
        rerenderedEnvironment.value = "environment-device-b";
        rerenderedEnvironment.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      // 머신을 바꾸면 그 머신 그룹의 프로젝트만 고를 수 있다.
      expect([...dialog?.querySelectorAll<HTMLElement>('.run-target-environment.active .run-target-project > header > strong') ?? []]
        .map((option) => option.textContent)).toEqual(["remote-project"]);
      dialog?.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="repo:remote-project"]')?.click();
      const targetMode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="targetMode"]');
      if (targetMode) {
        targetMode.value = "session";
        targetMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect([...dialog?.querySelectorAll<HTMLOptionElement>('[data-scope="task-run-routing"][data-field="sessionId"] option') ?? []]
        .map((option) => option.textContent)).toEqual(["세션 미지정 · 새 세션", "Remote Codex · remote-project"]);
    } finally {
      dom.window.close();
    }
  });

  it("offers every agent session in the selected local Orca for Task and Graph execution", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      store.graphs[0].defaults = { environmentId: "local", projectId: "project-a", model: "gpt-5.6-sol" };
      targets.environments = [{ id: "local", name: "device-a", local: true, connected: true }];
      targets.projects = [
        { id: "project-a", name: "Project A", environmentId: "local", worktreeId: "worktree-a", path: "/workspace/a", branch: "main", current: true },
        { id: "project-b", name: "Project B", environmentId: "local", worktreeId: "worktree-b", path: "/workspace/b", branch: "dev" },
      ];
      targets.sessions = [
        { id: "session-a-main", title: "A Main", environmentId: "local", worktreeId: "worktree-a", projectId: "project-a", branch: "main", paneKey: "a:main", agentType: "codex", agentState: "done", connected: true, writable: true },
        { id: "session-a-review", title: "A Review", environmentId: "local", worktreeId: "worktree-a-review", projectId: "project-a", branch: "review", paneKey: "a:review", agentType: "claude", agentState: "done", connected: true, writable: true },
        { id: "session-b-dev", title: "B Dev", environmentId: "local", worktreeId: "worktree-b", projectId: "project-b", branch: "dev", paneKey: "b:dev", agentType: "codex", agentState: "done", connected: true, writable: true },
      ];
    });
    try {
      const { document, Event } = dom.window;
      const expectEverySession = (select: HTMLSelectElement | null | undefined): void => {
        expect([...(select?.options ?? [])].map((item) => item.value)).toEqual([
          "", "session-a-main", "session-a-review", "session-b-dev",
        ]);
      };

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"]')?.click();
      let targetMode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="targetMode"]');
      if (targetMode) {
        targetMode.value = "session";
        targetMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expectEverySession(document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="sessionId"]'));

      document.querySelector<HTMLButtonElement>('[data-action="close-modal"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      targetMode = document.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="targetMode"]');
      if (targetMode) {
        targetMode.value = "session";
        targetMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expectEverySession(document.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="sessionId"]'));
    } finally {
      dom.window.close();
    }
  });

  it("allows zero or multiple project and worktree selections at run time", async () => {
    const dom = await mountPanel(({ targets }) => {
      targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", worktreeId: "wt-api", path: "/workspace/api", branch: "main" },
        { id: "project-web", name: "Web", environmentId: "local", worktreeId: "wt-web", path: "/workspace/web", branch: "release" },
      ];
      targets.branches = [
        { id: "branch-api", branch: "main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/workspace/api" },
        { id: "branch-web", branch: "release", environmentId: "local", projectId: "project-web", worktreeId: "wt-web", path: "/workspace/web" },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"]')?.click();

      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelectorAll('[data-action="toggle-run-worktree"]:checked')).toHaveLength(0);
      expect(dialog?.textContent).toContain("선택 안 함");
      expect(dialog?.textContent).toContain("현재 Orca 컨텍스트");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);

      dialog?.querySelector<HTMLInputElement>('[data-project-id="project-api"]')?.click();
      document.querySelector<HTMLInputElement>('[data-project-id="project-web"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelectorAll('[data-action="toggle-run-worktree"]:checked')).toHaveLength(2);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-mode"]')).not.toBeNull();

      dialog?.querySelector<HTMLInputElement>('[data-project-id="project-api"]')?.click();
      document.querySelector<HTMLInputElement>('[data-project-id="project-web"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelectorAll('[data-action="toggle-run-worktree"]:checked')).toHaveLength(0);
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it("selects the one machine that can satisfy every saved Task project and branch", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      const now = "2026-08-10T00:00:00.000Z";
      store.tasks = [{
        id: "task-remote", title: "원격 다중 프로젝트", prompt: "work", draft: "work", promptRevisions: [],
        status: "ready", priority: "medium", tags: [], createdAt: now, updatedAt: now,
        projects: [
          { id: "TP-front", role: "target", locatorKind: "folder", locator: "/remote/front", label: "Front", branch: "feature/task", position: 0 },
          { id: "TP-api", role: "target", locatorKind: "folder", locator: "/remote/api", label: "API", branch: "feature/task", position: 1 },
        ],
      }];
      targets.environments = [
        { id: "local", name: "device-a", local: true, connected: true },
        { id: "environment-device-b", name: "device-b", local: false, connected: true },
      ];
      targets.projects = [
        { id: "repo-front", name: "front", environmentId: "local", path: "/local/front", worktreeId: "wt-front-local", branch: "dev" },
        { id: "repo-api", name: "api", environmentId: "local", path: "/local/api", worktreeId: "wt-api-local", branch: "dev" },
        { id: "repo-front", name: "front", environmentId: "environment-device-b", path: "/remote/front", worktreeId: "wt-front-remote", branch: "dev" },
        { id: "repo-api", name: "api", environmentId: "environment-device-b", path: "/remote/api", worktreeId: "wt-api-remote", branch: "dev" },
      ];
      targets.branches = [
        { id: "front-hotfix", branch: "feature/task", environmentId: "local", projectId: "repo-front", worktreeId: "wt-front-hotfix", path: "/local/worktrees/front" },
        { id: "api-hotfix", branch: "feature/task", environmentId: "local", projectId: "repo-api", worktreeId: "wt-api-hotfix", path: "/local/worktrees/api" },
        { id: "front-dev", branch: "dev", environmentId: "environment-device-b", projectId: "repo-front", worktreeId: "wt-front-remote", path: "/remote/front" },
        { id: "api-dev", branch: "dev", environmentId: "environment-device-b", projectId: "repo-api", worktreeId: "wt-api-remote", path: "/remote/api" },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      const taskCard = document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]');
      const taskId = taskCard?.dataset.id;
      taskCard?.click();
      document.querySelector<HTMLButtonElement>(`[data-action="open-task-run"][data-id="${taskId}"]`)?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector<HTMLSelectElement>('[data-field="environmentId"]')?.value).toBe("local");
      expect([...dialog?.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]:checked') ?? []].map((input) => input.dataset.projectId)).toEqual(["repo-api", "repo-front"]);
      // 저장된 Task 브랜치의 워크트리 행이 체크된다.
      expect([...dialog?.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]:checked') ?? []].map((input) => input.dataset.branch)).toEqual(["feature/task", "feature/task"]);
      expect(dialog?.textContent).not.toContain("새 세션을 만들 프로젝트를 선택하십시오");
    } finally {
      dom.window.close();
    }
  });


  it("restores the last Task route and keeps the run dialog open when the send fails", async () => {
    const host = terminalHost([]);
    const dom = await mountPanel((bootstrap) => {
      bootstrap.store.dispatchLog = [{
        id: "dispatch-previous", itemKind: "task", itemId: "task-design", title: "요구사항 설계",
        dispatchedAt: "2026-08-10T00:00:00.000Z", executionMode: "single_session",
        targets: [{
          label: "Current", environmentId: "local", projectId: "repo:current-project",
          branch: "feature/review", sessionId: "session-previous", sessionTitle: "Review Agent",
          model: "claude-opus-5", opened: "existing-session",
        }],
      }];
      bootstrap.targets.projects = [{
        id: "repo:current-project", name: "current-project", environmentId: "local",
        worktreeId: "worktree-current", path: "/workspace/current", branch: "feature/review",
      }];
      bootstrap.targets.sessions = [{
        id: "session-previous", title: "Review Agent", environmentId: "local", worktreeId: "worktree-current",
        projectId: "repo:current-project", branch: "feature/review", paneKey: "tab:leaf", agentType: "claude",
        agentState: "done", connected: true, writable: true,
      }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();

      // 지난번에 어디로 보냈는지가 기본값이 된다.
      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector<HTMLSelectElement>('[data-field="sessionId"]')?.value).toBe("session-previous");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-field="model"]')?.value).toBe("claude-opus-5");

      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.getAttribute("aria-busy")).toBe("true");
      await settle(dom);

      // 워크트리에 터미널이 하나도 없어 명령을 보낼 수 없다. 창을 닫아 버리면
      // 사용자가 방금 고른 설정을 다시 입력해야 한다.
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.getAttribute("aria-busy")).toBe("false");
      expect(dialog?.textContent).toContain("열린 터미널이 없습니다");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-field="sessionId"]')?.value).toBe("session-previous");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-field="model"]')?.value).toBe("claude-opus-5");
    } finally {
      dom.window.close();
    }
  });

  it("creates or opens a Todo Task and selects its predefined worktree Graph", async () => {
    const dom = await mountPanel(({ store }) => {
      const now = "2026-08-10T00:00:00.000Z";
      store.todos = [
        {
          id: "todo-unbound", title: "Task 없는 ToDo", notes: "1차 진행중", draft: "Task 생성 대상",
          promptRevisions: [], status: "open", priority: "medium", tags: [], createdAt: now, updatedAt: now,
        },
        {
          id: "todo-bound", title: "Graph 연결 ToDo", notes: "정지희 1차 후 정석진 작업 예정", draft: "Graph 선택 대상",
          promptRevisions: [], status: "open", priority: "medium", tags: [], taskId: "task-design", createdAt: now, updatedAt: now,
        },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector<HTMLButtonElement>('[aria-label^="Task 실행"]')).not.toBeNull();

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      const manager = document.querySelector<HTMLElement>('[aria-label="Todo 관리"]');
      expect(manager?.querySelector('[placeholder]')).toBeNull();
      expect(manager?.textContent).toContain("1차 진행중");
      expect(manager?.textContent).toContain("정지희 1차 후 정석진 작업 예정");
      expect(manager?.querySelector<HTMLButtonElement>('[data-action="create-task-for-todo"][data-id="todo-unbound"]')?.textContent).toContain("+ Task 생성");
      const disabledGraph = manager?.querySelector<HTMLButtonElement>('[data-action="choose-todo-graph"][data-id="todo-unbound"]');
      expect(disabledGraph?.disabled).toBe(true);
      expect(disabledGraph?.title).toBe("먼저 Task를 생성하십시오");
      expect(manager?.querySelector<HTMLButtonElement>('[data-action="open-linked-task"][data-id="task-design"]')?.textContent).toContain("Task 열기");

      manager?.querySelector<HTMLButtonElement>('[data-action="choose-todo-graph"][data-id="todo-bound"]')?.click();
      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("워크트리 Graph 선택");
      expect(dialog?.textContent).toContain("Orca 그래프 엔지니어링");
      dialog?.querySelector<HTMLButtonElement>('[data-action="select-todo-graph"]')?.click();
      expect(document.querySelector('[data-canvas]')).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("keeps an archived Todo comment visible and read-only without placeholders", async () => {
    const dom = await mountPanel(({ store }) => {
      const now = "2026-08-10T00:00:00.000Z";
      store.todos = [{
        id: "todo-archived", title: "보관 ToDo", notes: "정지희 1차 후 정석진 작업 예정", draft: "보관 항목",
        promptRevisions: [], status: "open", priority: "medium", tags: [], archivedAt: now, createdAt: now, updatedAt: now,
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      const manager = document.querySelector<HTMLElement>('[aria-label="Todo 관리"]');
      expect(manager?.textContent).toContain("정지희 1차 후 정석진 작업 예정");
      expect(manager?.querySelector('[placeholder]')).toBeNull();
      expect(manager?.querySelector<HTMLButtonElement>('[data-action="select-local-todo"][aria-label="코멘트 보기"]')?.disabled).toBe(true);
      manager?.querySelector<HTMLButtonElement>('[data-action="select-local-todo"][data-id="todo-archived"]:not(.todo-card-comment)')?.click();
      const comment = document.querySelector<HTMLTextAreaElement>('[data-scope="local-todo"][data-field="notes"]');
      expect(comment?.value).toBe("정지희 1차 후 정석진 작업 예정");
      expect(comment?.disabled).toBe(true);
      expect(comment?.hasAttribute("placeholder")).toBe(false);
    } finally {
      dom.window.close();
    }
  });


  it("shows what was sent, where, and when — and nothing it cannot observe", async () => {
    // 패널에는 세션에서 돌아오는 채널이 없다. 진행률이나 완료를 지어내면 사용자는
    // 확인되지 않은 상태를 사실로 읽는다.
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [{
        id: "dispatch-1", itemKind: "task", itemId: "task-design", title: "요구사항 설계",
        dispatchedAt: "2026-08-10T01:00:00.000Z", executionMode: "single_session",
        targets: [{
          label: "current-project", projectName: "current-project", branch: "main",
          sessionId: "session-a", sessionTitle: "Codex", model: "gpt-5.6-sol", opened: "existing-session",
        }],
      }];
    });
    try {
      const { document } = dom.window;
      expect(document.querySelector('[data-action="set-view"][data-id="executions"]')?.textContent).toContain("1");
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const manager = document.querySelector<HTMLElement>(".execution-manager");
      expect(manager?.textContent).toContain("요구사항 설계");
      expect(manager?.textContent).toContain("current-project");
      expect(manager?.textContent).toContain("Codex");
      expect(manager?.textContent).toContain("전달 뒤의 진행은 각 세션에서 확인하십시오");
      // 대상 목록에 없는 세션은 닫힌 것으로 본다 — 추정이 아니라 마지막 갱신의 관측이다.
      expect(manager?.querySelector(".dispatch-state")?.textContent).toBe("닫힘");
      // 관측할 수 없는 것은 그리지 않는다.
      expect(manager?.querySelector(".execution-progress")).toBeNull();
      expect(manager?.textContent).not.toContain("실행 중");

      // Task 실행 버튼은 보낸 뒤에도 계속 눌릴 수 있어야 한다 — 끝났는지 알 수 없으므로
      // 잠그면 사용자가 다시 보낼 방법이 사라진다.
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      const row = document.querySelector<HTMLElement>('[data-action="select-local-task"][data-id="task-design"]')?.closest(".work-card-row");
      expect(row?.querySelector<HTMLButtonElement>('[data-action="open-task-run"]')?.disabled).toBe(false);
      expect(row?.querySelector(".dispatch-inline")).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("shows the run work input, per-node outcome, and failure reason in the execution status view", async () => {
    const dom = await mountPanel((bootstrap) => {
      bootstrap.store.graphs[0].runs = [{
        id: "run-1", runNo: 7, status: "failed", startedAt: "2026-08-11T03:00:00.000Z",
        endedAt: "2026-08-11T03:04:00.000Z", trigger: "manual", terminationReason: "node_failed",
        inputPrompt: "상속바로 백오피스 고객재등록 버튼 복구",
        nodeResults: [
          { nodeId: "node-design", status: "done", attempt: 1, durationMs: 42_000, sessionId: "term-a", sessionTitle: "설계 세션", message: "RESULT: done" },
          { nodeId: "node-implement", status: "failed", attempt: 2, durationMs: 7_000, sessionId: "term-b", message: "필수 템플릿 계약값 누락으로 blocked" },
        ],
      }];
      bootstrap.store.dispatchLog = [{
        id: "dispatch-graph", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 그래프 엔지니어링",
        dispatchedAt: "2026-08-11T03:00:00.000Z", executionMode: "single_session",
        targets: [{ label: "current-project", projectName: "current-project", opened: "new-session" }],
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const history = document.querySelector<HTMLElement>(".execution-group");
      expect(history?.textContent).toContain("Run #7");
      expect(history?.textContent).toContain("상속바로 백오피스 고객재등록 버튼 복구");
      expect(history?.textContent).toContain("요구사항 설계");
      expect(history?.textContent).toContain("설계 세션");
      const failedNode = history?.querySelector<HTMLElement>(".run-node.status-failed");
      expect(failedNode?.textContent).toContain("구현 및 검증");
      expect(failedNode?.textContent).toContain("필수 템플릿 계약값 누락으로 blocked");
      expect(failedNode?.textContent).toContain("시도 2");
    } finally {
      dom.window.close();
    }
  });

  it("shows the run on the canvas from what the session reported, node by node", async () => {
    // 로컬 저장소에는 원천이 채워 주는 run 기록이 없다. 그래프를 보낸 뒤 캔버스가
    // 아무 말도 하지 않으면 도는 중인지 끝났는지 알 수 없다.
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [{
        id: "d-graph", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 그래프 엔지니어링",
        dispatchedAt: "2026-08-12T05:00:00.000Z", executionMode: "single_session",
        targets: [{
          label: "API", projectName: "API", sessionId: "term_live", opened: "new-session",
          outcome: { status: "running", observedAt: "2026-08-12T05:05:00.000Z" },
          nodeStates: {
            "node-design": { status: "done", message: "설계 정리함" },
            "node-implement": { status: "failed", message: "템플릿 값 누락" },
          },
        }],
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();

      const banner = document.querySelector<HTMLElement>(".canvas-run-banner");
      expect(banner?.textContent).toContain("진행중");
      expect(banner?.textContent).toContain("API");
      // 세션이 보고한 노드 수만 센다. 나머지를 진행률로 지어내지 않는다.
      expect(banner?.textContent).toContain("노드 2/4 보고");
      expect(banner?.textContent).toContain("실패 1");
      expect(banner?.querySelector('[data-action="focus-session"]')).not.toBeNull();

      // 캔버스의 노드도 그 보고대로 칠해진다.
      expect(document.querySelector('.node[data-node-id="node-design"]')?.className).toContain("execution-done");
      expect(document.querySelector('.node[data-node-id="node-implement"]')?.className).toContain("execution-failed");
      expect(document.querySelector('.node[data-node-id="node-quality-graph-call"]')?.className).toContain("execution-pending");
      // 상태 점이 노드마다 붙는다 — 글자를 읽지 않아도 상태가 보인다.
      expect(document.querySelector('.node[data-node-id="node-design"] .node-run-dot')?.className).toContain("done");
      expect(document.querySelector('.node[data-node-id="node-implement"] .node-run-dot')?.className).toContain("failed");
    } finally {
      dom.window.close();
    }
  });

  it("leaves refreshing to the user and shows the run it already observed", async () => {
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [{
        id: "d-graph", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 그래프 엔지니어링",
        dispatchedAt: "2026-08-12T05:00:00.000Z", executionMode: "single_session",
        targets: [{
          label: "API", projectName: "API", sessionId: "term_live", opened: "new-session",
          outcome: { status: "done", observedAt: "2026-08-12T05:05:00.000Z" },
          nodeStates: { "node-design": { status: "done" } },
        }],
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      expect(document.querySelector(".canvas-run-banner")?.textContent).toContain("성공");
      // 갱신은 사람이 누른다. 패널이 스스로 다시 열지 않는다.
      expect(document.querySelector('[data-action="toggle-run-follow"]')).toBeNull();
      expect(document.querySelector('.canvas-run-banner [data-action="refresh-data"]')).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("keeps the running animations in the stylesheet the canvas depends on", async () => {
    // jsdom은 animation shorthand를 계산하지 못한다. 규칙이 사라지지 않았는지만 지킨다.
    const css = await readFile(path.join(root, "src/panel.css"), "utf8");
    expect(css).toContain("@keyframes node-run-dash");
    expect(css).toContain("@keyframes node-run-ping");
    expect(css).toContain("@keyframes edge-flow");
    expect(css).toMatch(/\.node\.execution-running \.node-shape \{[^}]*animation: node-run-dash/u);
    expect(css).toMatch(/\.node-run-dot\.running::after \{[^}]*animation: node-run-ping/su);
    expect(css).toMatch(/\.edge\.active-flow, \.edge\.into-running \{[^}]*animation: edge-flow/u);
    // 실행 중에는 임계 경로 색이 실행 색을 흉내 내지 않아야 한다.
    expect(css).toContain(".canvas-shell.has-run .node.execution-pending .node-shape");
  });

  it("marks the node the session says it is working on right now", async () => {
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [{
        id: "d-graph", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 그래프 엔지니어링",
        dispatchedAt: "2026-08-12T05:00:00.000Z", executionMode: "single_session",
        targets: [{
          label: "API", projectName: "API", sessionId: "term_live", opened: "new-session",
          outcome: { status: "running", observedAt: "2026-08-12T05:05:00.000Z" },
          nodeStates: {
            "node-design": { status: "done" },
            "node-implement": { status: "running" },
          },
        }],
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      // 지금 도는 노드는 테두리와 점으로 구분되고, 아직 보고가 없는 노드는 뒤로 물린다.
      expect(document.querySelector('.node[data-node-id="node-implement"]')?.className).toContain("execution-running");
      expect(document.querySelector('.node[data-node-id="node-implement"] .node-run-dot')?.className).toContain("running");
      expect(document.querySelector("[data-canvas]")?.className).toContain("has-run");

      // 끝난 노드에서 나가는 연결과 도는 노드로 들어가는 연결이 흐른다.
      const edges = [...document.querySelectorAll<SVGPathElement>("path.edge")]
        .map((edge) => edge.getAttribute("class") ?? "");
      expect(edges.some((value) => value.includes("completed"))).toBe(true);
      expect(edges.some((value) => value.includes("into-running"))).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it("shows a node's instructions and last run outcome on hover, and offers a run-history reset", async () => {
    const dom = await mountPanel((bootstrap) => {
      bootstrap.store.graphs[0].runs = [{
        id: "run-1", runNo: 3, status: "failed", startedAt: "2026-08-11T03:00:00.000Z", trigger: "manual",
        nodeResults: [{ nodeId: "node-implement", status: "failed", attempt: 1, durationMs: 5_000, sessionTitle: "구현 세션", message: "필수 템플릿 계약값 누락으로 blocked" }],
      }];
    });
    try {
      const { document } = dom.window;
      // 노드에 올리면 그 노드가 무엇을 시키는지와 최근 실행 결과가 카드로 뜬다.
      const node = document.querySelector<HTMLElement>('.node[data-node-id="node-implement"]');
      node?.dispatchEvent(new dom.window.Event("pointerover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      let card = document.querySelector<HTMLElement>(".node-hover-card");
      expect(card?.textContent).toContain("구현 및 검증");
      expect(card?.querySelector(".node-hover-body")?.textContent).toContain("승인된 설계를 구현하고");
      expect(card?.textContent).toContain("Run #3");
      expect(card?.textContent).toContain("필수 템플릿 계약값 누락으로 blocked");
      expect(card?.textContent).toContain("구현 세션");

      // 다른 노드로 옮기면 그 노드의 내용으로 바뀐다.
      document.querySelector<HTMLElement>('.node[data-node-id="node-design"]')
        ?.dispatchEvent(new dom.window.Event("pointerover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      card = document.querySelector<HTMLElement>(".node-hover-card");
      expect(card?.textContent).toContain("요구사항 설계");
      expect(card?.textContent).toContain("실행 기록이 아직 없습니다");

      // 끌기 시작하면 카드는 곧바로 사라진다 — 남으면 엉뚱한 자리를 가리킨다.
      document.querySelector<HTMLElement>("[data-canvas]")
        ?.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
      expect(document.querySelector(".node-hover-card")).toBeNull();
      expect(document.querySelectorAll('[data-action="reset-graph-history"]').length).toBeGreaterThan(0);
    } finally {
      dom.window.close();
    }
  });


  it("shows each dispatched session's observed state, last line, and a way to open it", async () => {
    // "보냈다"만 남으면 실행 현황은 읽을 게 없다. 세션이 살아 있는지, 화면에 마지막으로
    // 무엇이 찍혔는지는 갱신 때 관측한 사실이므로 그대로 옮긴다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ store, targets }) => {
      store.dispatchLog = [{
        id: "dispatch-live", itemKind: "task", itemId: "task-design", title: "요구사항 설계",
        dispatchedAt: "2026-08-12T01:00:00.000Z", executionMode: "single_session",
        targets: [
          { label: "API", projectName: "API", branch: "main", sessionId: "term_live", sessionTitle: "GE · API", model: "claude-opus-5", opened: "new-session" },
          { label: "Web", projectName: "Web", branch: "release", sessionId: "term_closed", opened: "new-session" },
        ],
      }];
      targets.sessions = [{
        id: "term_live", title: "GE · API", environmentId: "local", worktreeId: "wt-api",
        projectId: "project-api", branch: "refs/heads/main", paneKey: "a:1", agentType: "claude",
        agentState: "working", connected: true, writable: true,
        preview: "테스트를 실행하는 중입니다", lastOutputAt: new Date().toISOString(),
      }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const states = [...document.querySelectorAll<HTMLElement>(".dispatch-state")].map((item) => item.textContent);
      expect(states).toEqual(["작업 중", "닫힘"]);
      expect(document.querySelector(".dispatch-preview")?.textContent).toContain("테스트를 실행하는 중입니다");

      // 패널은 Orca UI를 못 만진다. 세션으로 가는 것도 CLI 한 줄로 부탁한다.
      document.querySelector<HTMLButtonElement>('[data-action="focus-session"][data-id="term_live"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);
      expect(host.commands[0]).toContain('focus "term_live"');
    } finally {
      dom.window.close();
    }
  });

  it("groups runs into 진행중 · 성공 · 실패 from what the sessions reported", async () => {
    // 패널은 진행률을 지어내지 않는다. 프롬프트가 요구한 결과 줄을 갱신 때 읽어 둔
    // 것만으로 나눈다 — 결과 없이 세션이 사라졌으면 실패다.
    const dom = await mountPanel(({ store }) => {
      const at = "2026-08-12T04:00:00.000Z";
      store.dispatchLog = [
        {
          id: "d-running", itemKind: "task", itemId: "task-a", title: "도는 중",
          dispatchedAt: "2026-08-12T03:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "API", sessionId: "t1", opened: "new-session", outcome: { status: "running", observedAt: at } }],
        },
        {
          id: "d-done", itemKind: "task", itemId: "task-b", title: "끝난 것",
          dispatchedAt: "2026-08-12T02:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "API", sessionId: "t2", opened: "new-session", outcome: { status: "done", observedAt: at } }],
        },
        {
          id: "d-failed", itemKind: "task", itemId: "task-c", title: "실패한 것",
          dispatchedAt: "2026-08-12T01:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "API", sessionId: "t3", opened: "new-session", outcome: { status: "failed", message: "템플릿 값 누락", observedAt: at } }],
        },
        {
          id: "d-closed", itemKind: "task", itemId: "task-d", title: "결과 없이 닫힘",
          dispatchedAt: "2026-08-12T00:30:00.000Z", executionMode: "single_session",
          targets: [{ label: "API", sessionId: "t4", opened: "new-session", outcome: { status: "closed", observedAt: at } }],
        },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const manager = document.querySelector<HTMLElement>(".execution-manager");
      expect(manager?.querySelector(".execution-manager-header")?.textContent).toContain("진행중 1 · 성공 1 · 실패 2");
      expect([...manager?.querySelectorAll<HTMLElement>(".execution-section > header > strong") ?? []]
        .map((item) => item.textContent)).toEqual(["진행중", "성공", "실패"]);
      // 실패 이유는 화면에서 읽은 그대로 보여 준다.
      expect(manager?.textContent).toContain("템플릿 값 누락");
      expect(manager?.textContent).toContain("결과 없이 종료");

      // 카드를 누르면 그 실행의 상세가 열린다.
      manager?.querySelector<HTMLElement>('.execution-section.status-failed [data-action="open-dispatch-detail"]')?.click();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("실패한 것");
    } finally {
      dom.window.close();
    }
  });

  it("lists a Task's whole run history newest first, and deletes it by run or by Task", async () => {
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [
        { id: "run-3", itemKind: "task", itemId: "task-a", title: "반복 실행", dispatchedAt: "2026-08-12T03:00:00.000Z", executionMode: "single_session", targets: [{ label: "API", opened: "new-session" }] },
        { id: "run-2", itemKind: "task", itemId: "task-a", title: "반복 실행", dispatchedAt: "2026-08-12T02:00:00.000Z", executionMode: "single_session", targets: [{ label: "API", opened: "new-session" }] },
        { id: "run-1", itemKind: "task", itemId: "task-a", title: "반복 실행", dispatchedAt: "2026-08-12T01:00:00.000Z", executionMode: "single_session", targets: [{ label: "API", opened: "new-session" }] },
        { id: "other", itemKind: "task", itemId: "task-b", title: "다른 Task", dispatchedAt: "2026-08-12T00:00:00.000Z", executionMode: "single_session", targets: [{ label: "API", opened: "new-session" }] },
      ];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const card = document.querySelector<HTMLElement>(".dispatch-card");
      expect(card?.textContent).toContain("실행 이력 3건");

      // 접혀 있다가 펼치면 그 항목의 이력이 최신순으로 전부 보인다.
      expect(card?.querySelector(".dispatch-runs")).toBeNull();
      card?.querySelector<HTMLElement>("header[data-action='toggle-execution-history']")?.click();
      let times = [...document.querySelectorAll<HTMLElement>(".dispatch-run time")].map((item) => item.textContent ?? "");
      expect(times).toHaveLength(3);
      expect([...times].sort().reverse()).toEqual(times);

      // 한 건만 지운다.
      document.querySelector<HTMLButtonElement>('[data-action="delete-dispatch-record"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);
      times = [...document.querySelectorAll<HTMLElement>(".dispatch-run time")].map((item) => item.textContent ?? "");
      expect(times).toHaveLength(2);
      let saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      expect(saved.deletions.dispatchIds).toEqual(["run-3"]);

      // 그 항목의 이력을 통째로 지운다. 다른 항목은 남는다.
      host.commands.length = 0;
      document.querySelector<HTMLButtonElement>('[data-action="delete-dispatch-item"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);
      expect([...document.querySelectorAll<HTMLElement>(".dispatch-card")].map((item) => item.textContent))
        .toEqual([expect.stringContaining("다른 Task")]);
      saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      // run-3은 앞선 저장에서 이미 나갔다. 같은 삭제를 두 번 보내지 않는다.
      expect(saved.deletions.dispatchIds.sort()).toEqual(["run-1", "run-2"]);
    } finally {
      dom.window.close();
    }
  });

  it("opens an execution detail with the prompt that was actually sent", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      store.dispatchLog = [
        {
          id: "dispatch-new", itemKind: "task", itemId: "task-design", title: "요구사항 설계",
          dispatchedAt: "2026-08-12T02:00:00.000Z", executionMode: "per_project",
          prompt: "Task: 요구사항 설계\n\n이 작업만 수행하십시오.",
          targets: [{ label: "API", projectName: "API", branch: "main", sessionId: "term_live", opened: "new-session" }],
        },
        {
          id: "dispatch-old", itemKind: "task", itemId: "task-design", title: "요구사항 설계",
          dispatchedAt: "2026-08-12T01:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "API", projectName: "API", opened: "new-session" }],
          error: "세션이 닫혔습니다",
        },
      ];
      targets.sessions = [{
        id: "term_live", title: "GE · API", environmentId: "local", worktreeId: "wt-api",
        projectId: "project-api", paneKey: "a:1", agentType: "codex", agentState: "working",
        connected: true, writable: true, preview: "테스트 실행 중",
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      // 최근 실행 상세 버튼으로 그 실행을 펼쳐 본다.
      document.querySelector<HTMLElement>('.dispatch-card [data-action="open-dispatch-detail"]')?.click();

      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("요구사항 설계");
      expect(dialog?.textContent).toContain("프로젝트별");
      // 무엇을 보냈는지가 상세의 핵심이다.
      expect(dialog?.querySelector(".dispatch-prompt")?.textContent).toContain("이 작업만 수행하십시오");
      expect(dialog?.querySelector(".dispatch-state")?.textContent).toBe("작업 중");
      expect(dialog?.querySelector(".dispatch-preview")?.textContent).toContain("테스트 실행 중");

      // 같은 항목의 이전 실행으로 옮겨 갈 수 있다.
      expect(dialog?.textContent).toContain("같은 항목의 이전 실행 1");
      dialog?.querySelector<HTMLButtonElement>('.dispatch-history-list [data-action="open-dispatch-detail"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("세션이 닫혔습니다");
      expect(dialog?.textContent).toContain("프롬프트가 남아 있지 않습니다");
    } finally {
      dom.window.close();
    }
  });

  it("keeps the newest dispatch first and shows the graph run history beside it", async () => {
    const dom = await mountPanel(({ store }) => {
      store.dispatchLog = [
        {
          id: "dispatch-old", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 데모",
          dispatchedAt: "2026-08-10T01:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "current-project", opened: "new-session" }],
        },
        {
          id: "dispatch-new", itemKind: "graph", itemId: "graph-orca-demo", title: "Orca 데모",
          dispatchedAt: "2026-08-10T02:00:00.000Z", executionMode: "single_session",
          targets: [{ label: "current-project", opened: "new-session" }],
        },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]')?.click();
      const cards = [...document.querySelectorAll<HTMLElement>(".dispatch-card")];
      // 같은 항목의 실행은 카드 하나로 묶는다. 보낼 때마다 카드가 쌓이면 최신을 못 찾는다.
      expect(cards).toHaveLength(1);
      expect(cards[0]?.textContent).toContain("실행 이력 2건");
      // 펼치면 그 항목의 이력이 최신순으로 전부 보인다.
      expect(cards[0]?.querySelector(".dispatch-runs")).toBeNull();
      cards[0]?.querySelector<HTMLButtonElement>('footer [data-action="toggle-execution-history"]')?.click();
      const runs = [...document.querySelectorAll<HTMLElement>(".dispatch-run time")].map((item) => item.textContent);
      expect(runs).toHaveLength(2);
      expect(runs[0]! > runs[1]!).toBe(true);
      expect(document.querySelectorAll(".execution-group")).toHaveLength(1);
      expect(document.querySelector(".execution-group")?.textContent).toContain("graph-orca-demo");
    } finally {
      dom.window.close();
    }
  });

  it("prepares a failed active process run as a new run with its previous work input", async () => {
    const dom = await mountPanel((bootstrap) => {
      const { store } = bootstrap;
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://workspace.example.test" },
        status: "ready", catalog: [], capabilities: { execution: { nodeKinds: ["task", "condition", "graph_call"] } },
      };
      const graph = store.graphs[0]!;
      graph.processEnabled = true;
      graph.edges = graph.edges.filter((edge: { kind: string }) => edge.kind !== "loop");
      graph.nodes[0]!.status = "failed";
      graph.runs = [{
        id: "run-failed-active", runNo: 7, status: "running", trigger: "manual",
        startedAt: "2026-08-10T01:00:00.000Z", inputPrompt: "기존 업무 입력",
        stats: { completed: 0, failed: 1, attempts: 1 }, nodeResults: [],
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("실패 Run #7 재실행");
      expect(dialog?.querySelector('[data-field="startNewRun"]')).toBeNull();
      expect(dialog?.querySelector<HTMLTextAreaElement>('[data-field="inputPrompt"]')?.value).toBe("기존 업무 입력");
      expect(dialog?.querySelector<HTMLTextAreaElement>('[data-field="inputPrompt"]')?.readOnly).toBe(false);
    } finally {
      dom.window.close();
    }
  });


  it("does not let canvas pointer handling swallow a real execution status button click", async () => {
    const dom = await mountPanel();
    try {
      const { document, MouseEvent } = dom.window;
      const canvas = document.querySelector<HTMLElement>("[data-canvas]");
      canvas?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
      dom.window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
      const statusButton = document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="executions"]');
      statusButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(document.querySelector(".execution-manager")).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });


  it("saves graph launch settings without sending the graph to a session", async () => {
    const host = terminalHost();
    const dom = await mountPanel(undefined, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const saveButton = dialog?.querySelector<HTMLButtonElement>('[data-action="save-run-settings"]');
      expect(saveButton?.textContent).toBe("저장");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.textContent).toContain("실행 시작");
      saveButton?.click();
      expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe("true");
      await settle(dom);
      await waitForCommands(host, 1);

      const decoded = host.commands.flatMap(decodeCommands);
      expect(decoded.map((entry) => entry.command)).toEqual(["save"]);
      expect(decoded[0]?.payload.graphs.find((graph: any) => graph.id === "graph-orca-demo")?.engineering?.executionMode)
        .toBe("single_session");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector(".execution-manager")).toBeNull();
    } finally {
      dom.window.close();
    }
  });


  it("saves and restores Task launch settings without sending the Task", async () => {
    const host = terminalHost();
    const dom = await mountPanel((bootstrap) => {
      bootstrap.targets.projects = [{
        id: "repo:current-project", name: "current-project", environmentId: "local",
        worktreeId: "worktree-current", path: "/workspace/current", branch: "main", current: true,
      }];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      const model = document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]');
      if (model) {
        model.value = "claude-opus-5";
        model.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="save-task-run-settings"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const decoded = host.commands.flatMap(decodeCommands);
      // 저장만 한다. 설정을 남기려고 세션을 깨우지 않는다.
      expect(decoded.map((entry) => entry.command)).toEqual(["save"]);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector(".execution-manager")).toBeNull();

      // 다시 열면 저장된 설정이 그대로 복원된다.
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      expect(document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]')?.value)
        .toBe("claude-opus-5");
    } finally {
      dom.window.close();
    }
  });


  it("saves the graph, then sends it to the selected session as one command each", async () => {
    const host = terminalHost();
    const dom = await mountPanel(({ targets }) => {
      targets.projects = [{ id: "repo:current-project", name: "current-project", environmentId: "local", worktreeId: "worktree-current", current: true }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const decoded = host.commands.flatMap(decodeCommands);
      // 저장이 먼저다. 보낸 프롬프트가 저장되지 않은 그래프를 가리키면 세션이 읽는
      // 정본과 패널이 보여 주는 것이 갈린다.
      expect(decoded.map((entry) => entry.command)).toEqual(["save", "dispatch"]);
      // 두 명령은 반드시 한 줄이어야 한다. 줄을 나눠 보내면 저장이 도는 동안 타이핑된
      // 실행 줄이 tty 정규 모드 버퍼(macOS 1024B)에서 잘려 실행이 통째로 사라진다.
      expect(host.commands).toHaveLength(1);
      expect(host.commands[0]).toContain(" && ");
      const dispatch = decoded[1]!.payload;
      expect(dispatch.itemKind).toBe("graph");
      expect(dispatch.itemId).toBe("graph-orca-demo");
      expect(dispatch.prompt).toContain("이 그래프를 실행하십시오");
      expect(dispatch.prompt).toContain("RESULT: done");
      expect(dispatch.targets).toHaveLength(1);
      expect(dispatch.targets[0]).toMatchObject({ projectId: "repo:current-project", worktreeId: "worktree-current" });

      // 보낸 사실은 즉시 실행 현황에 남는다.
      expect(document.querySelector(".execution-manager")?.textContent).toContain("graph-orca-demo");
    } finally {
      dom.window.close();
    }
  });


  it("draws node status from the graph and its run history, never from a guess", async () => {
    const dom = await mountPanel(({ store }) => {
      const graph = store.graphs.find((item: any) => item.id === "graph-orca-demo");
      graph.nodes[0].status = "done";
      if (graph.nodes[1]) graph.nodes[1].status = "failed";
    });
    try {
      const { document } = dom.window;
      const nodes = [...document.querySelectorAll<HTMLElement>(".node[data-node-id]")];
      expect(nodes[0]?.className).toContain("execution-done");
      expect(nodes[1]?.className).toContain("execution-failed");
      // pending 노드를 "실행 대기"로 바꿔 부르지 않는다 — 큐가 없기 때문이다.
      expect(document.querySelector(".execution-queued")).toBeNull();
      expect(document.body.textContent).not.toContain("실행 대기");
    } finally {
      dom.window.close();
    }
  });

  it("really deletes a Task from a local store instead of archiving it", async () => {
    // "삭제"가 보관이면 목록에 계속 남는다. 로컬 저장소에서는 요청대로 지운다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(undefined, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      const deleteButton = document.querySelector<HTMLButtonElement>('[data-action="open-task-delete"]');
      const deletedTaskId = deleteButton?.dataset.id;
      expect(deleteButton?.classList.contains("danger")).toBe(true);
      deleteButton?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("되돌릴 수 없습니다");
      expect(dialog?.querySelector('[data-action="confirm-task-delete"]')?.textContent).toBe("영구 삭제");
      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-delete"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      // 목록에서 사라진다. 보관 카드로 남지 않는다.
      expect(document.querySelector<HTMLElement>('[role="dialog"]')).toBeNull();
      expect([...document.querySelectorAll<HTMLButtonElement>('[data-action="select-local-task"]')]
        .some((item) => item.dataset.id === deletedTaskId)).toBe(false);

      // 저장에도 삭제가 실려야 다음에 패널을 열 때 되살아나지 않는다.
      const saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      expect(saved.deletions.tasks).toEqual([deletedTaskId]);
    } finally {
      dom.window.close();
    }
  });

  it("archives instead of deleting when the source contract has no delete", async () => {
    const dom = await mountPanel((bootstrap: any) => {
      bootstrap.dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/" },
        status: "ready",
        catalog: [],
        capabilities: { domainMutation: true, milestoneMutation: true, taskMutation: true, todoMutation: true, graphCommit: true },
      };
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-delete"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      // 구조화 원천의 계약에는 삭제가 없다. 지운 척하지 않고 그렇게 말한다.
      expect(dialog?.textContent).toContain("삭제 대신 보관만 지원");
      expect(dialog?.querySelector('[data-action="confirm-task-delete"]')?.textContent).toBe("Task 보관");
    } finally {
      dom.window.close();
    }
  });

  it("keeps each management menu active after its own mutations", async () => {
    const dom = await mountPanel();
    try {
      const { document } = dom.window;
      const expectManager = (mode: "domains" | "milestones" | "tasks" | "todos", label: string): void => {
        const workspace = mode === "tasks"
          ? document.querySelector<HTMLElement>('[aria-label="Task 관리"], [aria-label="Task 상세"]')
          : document.querySelector<HTMLElement>(`[aria-label="${label} 관리"]`);
        expect(workspace).not.toBeNull();
        expect(document.querySelector<HTMLButtonElement>(`[data-action="set-view"][data-id="${mode}"]`)?.classList.contains("active")).toBe(true);
      };

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="domains"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-domain"]')?.click();
      expectManager("domains", "Domain");

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="milestones"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-milestone"]')?.click();
      expectManager("milestones", "Milestone");
      document.querySelector<HTMLButtonElement>('[data-action="archive-milestone"]')?.click();
      expectManager("milestones", "Milestone");

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-local-task"]')?.click();
      expectManager("tasks", "Task");

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-local-todo"]')?.click();
      expectManager("todos", "Todo");
      document.querySelector<HTMLButtonElement>('[data-action="toggle-todo-done"]')?.click();
      expectManager("todos", "Todo");
    } finally {
      dom.window.close();
    }
  });

  it("shows active Todos by default while preserving completed and cancelled history", async () => {
    const dom = await mountPanel((bootstrap) => {
      const now = "2026-08-09T00:00:00.000Z";
      const statuses = [
        ...Array<"open">(21).fill("open"),
        ...Array<"in_progress">(2).fill("in_progress"),
        ...Array<"done">(6).fill("done"),
        "cancelled" as const,
      ];
      bootstrap.store.todos = statuses.map((status, index) => ({
        id: `todo-${index + 1}`,
        version: index + 1,
        title: `Todo ${index + 1}`,
        notes: "",
        draft: `Todo ${index + 1}`,
        promptRevisions: [],
        status,
        priority: "medium",
        tags: [],
        groupName: index < 15 ? "제품" : "운영",
        subgroupName: index % 2 === 0 ? "v1" : "v2",
        createdAt: now,
        updatedAt: now,
      }));
    });
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();

      const filter = document.querySelector<HTMLSelectElement>('[data-action="todo-status-filter"]');
      expect(filter?.value).toBe("active");
      expect(document.querySelector<HTMLSelectElement>('[data-action="work-group"]')?.value).toBe("todo-group");
      expect([...document.querySelectorAll(".work-group > header strong")].some((item) => item.textContent === "제품 / v1")).toBe(true);
      expect(document.querySelector('[aria-label="Todo 관리"]')?.textContent).toContain("표시 23 · 활성 23 · 전체 30");
      expect(document.querySelectorAll(".work-list .work-card")).toHaveLength(23);

      if (filter) {
        filter.value = "all";
        filter.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector('[aria-label="Todo 관리"]')?.textContent).toContain("표시 30 · 활성 23 · 전체 30");
      expect(document.querySelectorAll(".work-list .work-card")).toHaveLength(30);

      const rerenderedFilter = document.querySelector<HTMLSelectElement>('[data-action="todo-status-filter"]');
      if (rerenderedFilter) {
        rerenderedFilter.value = "done";
        rerenderedFilter.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector('[aria-label="Todo 관리"]')?.textContent).toContain("표시 6 · 활성 23 · 전체 30");
      expect(document.querySelectorAll(".work-list .work-card")).toHaveLength(6);
    } finally {
      dom.window.close();
    }
  });

  it("manages Domain and Milestone scopes and filters grouped Task lists", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="domains"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-domain"]')?.click();
      const domainName = document.querySelector<HTMLInputElement>('[data-scope="local-domain"][data-field="name"]');
      expect(domainName).not.toBeNull();
      if (domainName) {
        domainName.value = "제품 개발";
        domainName.dispatchEvent(new Event("change", { bubbles: true }));
      }

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="milestones"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-milestone"]')?.click();
      const milestoneName = document.querySelector<HTMLInputElement>('[data-scope="local-milestone"][data-field="name"]');
      expect(milestoneName).not.toBeNull();
      if (milestoneName) {
        milestoneName.value = "v1 출시";
        milestoneName.dispatchEvent(new Event("change", { bubbles: true }));
      }

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-local-task"]')?.click();
      const domainSelect = document.querySelector<HTMLSelectElement>('[data-scope="local-task"][data-field="domainId"]');
      const domainId = [...domainSelect?.options ?? []].find((item) => item.textContent === "제품 개발")?.value;
      expect(domainId).toBeTruthy();
      if (domainSelect && domainId) {
        domainSelect.value = domainId;
        domainSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const milestoneSelect = document.querySelector<HTMLSelectElement>('[data-scope="local-task"][data-field="milestoneId"]');
      const milestoneId = [...milestoneSelect?.options ?? []].find((item) => item.textContent === "v1 출시")?.value;
      expect(milestoneId).toBeTruthy();
      if (milestoneSelect && milestoneId) {
        milestoneSelect.value = milestoneId;
        milestoneSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="back-to-task-list"]')?.click();
      const groupSelect = document.querySelector<HTMLSelectElement>('[data-action="work-group"]');
      if (groupSelect) {
        groupSelect.value = "milestone";
        groupSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect([...document.querySelectorAll(".work-group > header strong")].some((item) => item.textContent?.includes("제품 개발 / v1 출시"))).toBe(true);

      const groupToggle = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-work-group"]')]
        .find((item) => item.textContent?.includes("제품 개발 / v1 출시"));
      expect(groupToggle?.getAttribute("aria-expanded")).toBe("true");
      groupToggle?.click();
      const collapsedToggle = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-work-group"]')]
        .find((item) => item.textContent?.includes("제품 개발 / v1 출시"));
      expect(collapsedToggle?.getAttribute("aria-expanded")).toBe("false");
      expect(collapsedToggle?.closest(".work-group")?.querySelector(".work-card")).toBeNull();
      collapsedToggle?.click();
      const expandedToggle = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-work-group"]')]
        .find((item) => item.textContent?.includes("제품 개발 / v1 출시"));
      expect(expandedToggle?.getAttribute("aria-expanded")).toBe("true");
      expect(expandedToggle?.closest(".work-group")?.querySelector(".work-card")).not.toBeNull();

      const collapseAll = document.querySelector<HTMLButtonElement>('[data-action="collapse-all-work-groups"]');
      expect(collapseAll?.disabled).toBe(false);
      collapseAll?.click();
      const collapsedGroups = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-work-group"]')];
      expect(collapsedGroups.length).toBeGreaterThan(1);
      expect(collapsedGroups.every((item) => item.getAttribute("aria-expanded") === "false")).toBe(true);
      expect(document.querySelectorAll(".work-list .work-card")).toHaveLength(0);
      expect(document.querySelector<HTMLButtonElement>('[data-action="collapse-all-work-groups"]')?.disabled).toBe(true);

      document.querySelector<HTMLButtonElement>('[data-action="expand-all-work-groups"]')?.click();
      const expandedGroups = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-work-group"]')];
      expect(expandedGroups.every((item) => item.getAttribute("aria-expanded") === "true")).toBe(true);
      expect(document.querySelectorAll(".work-list .work-card").length).toBeGreaterThan(0);
      expect(document.querySelector<HTMLButtonElement>('[data-action="expand-all-work-groups"]')?.disabled).toBe(true);

      const search = document.querySelector<HTMLInputElement>('[data-action="work-search"]');
      if (search) {
        search.value = "v1 출시";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("새 Task");
    } finally {
      dom.window.close();
    }
  });


  it("keeps human Draft and Meta Draft separate and both hand-editable", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      const pair = document.querySelector<HTMLElement>('[aria-label="Draft와 Meta Draft"]');
      expect(pair).not.toBeNull();
      const draft = pair?.querySelector<HTMLTextAreaElement>('[data-field="draft"]');
      const meta = pair?.querySelector<HTMLTextAreaElement>('[data-field="metaDraft"]');
      expect(draft).not.toBeNull();
      // Meta Draft는 이제 사람이 직접 쓴다. 읽기 전용으로 두면 편집할 방법이 없다.
      expect(meta?.readOnly).toBe(false);
      expect(pair?.textContent).toContain("Meta Draft를 비워 두면");
      // 별도 세션을 띄우는 생성 버튼은 없다.
      expect(document.querySelector('[data-action="request-meta-prompt"]')).toBeNull();

      if (meta) {
        meta.value = "정제된 실행 프롬프트";
        meta.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector('.topbar .status-pill.warn')?.textContent).toContain("저장 안 됨");
    } finally {
      dom.window.close();
    }
  });

  it("renders condition nodes as real diamonds with size-aware edges", async () => {
    const dom = await mountProductionPanel();
    try {
      const { document } = dom.window;
      const condition = document.querySelector<HTMLElement>(".node.condition");
      expect(condition).not.toBeNull();
      expect(document.querySelector(".node.task svg.node-vector rect.node-shape")).not.toBeNull();
      expect(condition?.querySelector("svg.node-vector polygon.node-shape")?.getAttribute("points")).toBe("80,1 159,56 80,111 1,56");
      expect(condition?.querySelectorAll(".connect-port")).toHaveLength(4);
      expect(document.querySelectorAll(".node.graph_call svg.node-vector rect")).toHaveLength(2);
      const outgoing = document.querySelector<SVGPathElement>('[data-edge-id="edge-2"] .edge');
      expect(outgoing?.getAttribute("d")).toMatch(/^M 500 120 /u);
      expect(outgoing?.getAttribute("marker-end")).toBe("url(#arrow-y)");
      expect(document.querySelector('[data-edge-id="edge-2"] .edge-hit')).not.toBeNull();
      expect(document.querySelector('[data-edge-id="edge-2"] .edge-label-badge')?.textContent).toContain("Y");
      expect(document.querySelector('[data-edge-id="edge-loop"] .edge-label-badge')?.textContent).toContain("N");
      expect(document.querySelector(".canvas-shell")?.getAttribute("style")).toContain("--grid-major:");
      expect(document.querySelector(".minimap svg .mini-node.condition")).not.toBeNull();
      const taskNode = document.querySelector<HTMLElement>(".node.task");
      const taskBody = taskNode?.querySelector<HTMLElement>(".node-subtitle");
      expect(dom.window.getComputedStyle(taskNode!).height).toBe("124px");
      expect(dom.window.getComputedStyle(taskBody!).whiteSpace).toBe("normal");
      expect(taskBody?.getAttribute("title")).toBe(taskBody?.textContent);
    } finally {
      dom.window.close();
    }
  });

  it("drags nodes from the body as well as the edge", async () => {
    const dom = await mountPanel();
    try {
      const { document, MouseEvent } = dom.window;
      const node = document.querySelector<HTMLElement>(".node");
      const nodeId = node?.dataset.nodeId;
      const body = node?.querySelector<HTMLElement>(".node-body");
      expect(nodeId).toBeTruthy();
      expect(node?.dataset.dragNode).toBe(nodeId);
      expect(body?.closest("[data-drag-node]")).toBe(node);
      const initialLeft = node?.style.left;
      const initialTop = node?.style.top;

      body?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
      dom.window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 168, clientY: 144 }));
      dom.window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 168, clientY: 144 }));

      const moved = document.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
      expect(moved?.style.left).not.toBe(initialLeft);
      expect(moved?.style.top).not.toBe(initialTop);
    } finally {
      dom.window.close();
    }
  });

  it("exposes both data source modes and blocks split-brain structured execution", async () => {
    const dom = await mountPanel((bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready",
        source: { id: "workspace", name: "Workspace" },
        catalog: [{ id: "task-source", kind: "task", title: "Source task", body: "Do source work", version: 3, taskId: "task-source" }],
      };
    });
    try {
      const { document, Event } = dom.window;
      const headerSource = document.querySelector<HTMLButtonElement>('.topbar [data-action="open-data-source"]');
      const headerRefresh = document.querySelector<HTMLButtonElement>('.topbar [data-action="refresh-source"]');
      expect(headerSource?.nextElementSibling).toBe(headerRefresh);
      expect(headerRefresh?.textContent).toBe("새로고침");
      expect(headerRefresh?.getAttribute("aria-label")).toBe("데이터 원천 새로고침");
      expect(headerRefresh?.disabled).toBe(false);
      document.querySelector<HTMLButtonElement>('[data-action="open-data-source"]')?.click();
      const sourceDialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(sourceDialog?.textContent).toContain("구조화 Workspace");
      expect(sourceDialog?.textContent).toContain("구조 없음");
      expect(sourceDialog?.textContent).toContain("연결 상태 · Workspace");
      expect(sourceDialog?.textContent).not.toContain("Source task");
      expect(sourceDialog?.querySelector('[data-action="add-source-item"]')).toBeNull();
      const mode = sourceDialog?.querySelector<HTMLSelectElement>('[data-source-field="mode"]');
      expect([...(mode?.options ?? [])].map((item) => item.value)).toContain("folder");
      if (mode) {
        mode.value = "folder";
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const folderDialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(folderDialog?.textContent).toContain("폴더 또는 로컬 Git 저장소 경로");
      expect(folderDialog?.textContent).toContain("Git commit·push는 자동으로 실행하지 않습니다");
      expect(folderDialog?.querySelector('.source-folder.hidden')).toBeNull();
      expect(folderDialog?.querySelector('.source-remote.hidden')).not.toBeNull();
      const folderMode = folderDialog?.querySelector<HTMLSelectElement>('[data-source-field="mode"]');
      if (folderMode) {
        folderMode.value = "structured";
        folderMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLElement>('[role="dialog"]')?.querySelector<HTMLButtonElement>('[data-action="close-modal"]')?.click();
      // 실행은 대상 세션의 에이전트가 수행하므로 원천의 실행 지원 여부는 더 이상
      // 실행을 막는 조건이 아니다. 막는 것은 그래프 구조가 실제로 잘못됐을 때뿐이다.
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const runDialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(runDialog?.textContent).not.toContain("원격 실행을 지원하지 않습니다");
    } finally {
      dom.window.close();
    }
  });

  it("blocks model policy errors in the run modal", async () => {
    const dom = await mountPanel(({ store }) => {
      const graph = store.graphs[0];
      graph.edges = [{ id: "policy-edge", from: "retrying", to: "networked", kind: "sequence" }];
      graph.nodes = [
        {
          id: "retrying", kind: "task", label: "Retrying", x: 0, y: 0, status: "pending", joinMode: "all",
          task: { id: "task-retrying", title: "Retrying", prompt: "retry" },
          engineering: { maxAttempts: 2, permissions: ["read"] },
        },
        {
          id: "networked", kind: "task", label: "Networked", x: 200, y: 0, status: "pending", joinMode: "all",
          task: { id: "task-networked", title: "Networked", prompt: "network" },
          engineering: { dataClass: "sensitive", permissions: ["read", "network"] },
        },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("idempotency key");
      expect(dialog?.textContent).toContain("network 권한");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it("keeps Run visible and configures per-node routing with automatic conditions", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      targets.projects = [{ id: "repo:current-project", name: "current-project", worktreeId: "worktree-current-project", current: true }];
      const graph = store.graphs[0];
      graph.defaults = {};
      delete graph.engineering;
      graph.nodes = [
        {
          id: "review", kind: "task", label: "코드 검토", x: 0, y: 0, status: "pending", joinMode: "all",
          task: { id: "task-review", title: "코드 검토", prompt: "review" },
        },
        {
          id: "decision", kind: "condition", label: "수정 필요?", x: 260, y: 0, status: "pending", joinMode: "all",
          conditionExpr: "blocking_findings == true",
        },
        {
          id: "request", kind: "task", label: "수정 요청", x: 520, y: -80, status: "pending", joinMode: "all",
          task: { id: "task-request", title: "수정 요청", prompt: "request changes" },
        },
        {
          id: "approve", kind: "task", label: "승인", x: 520, y: 80, status: "pending", joinMode: "all",
          task: { id: "task-approve", title: "승인", prompt: "approve" },
        },
      ];
      graph.edges = [
        { id: "review-decision", from: "review", to: "decision", kind: "sequence" },
        { id: "decision-request", from: "decision", to: "request", kind: "sequence", branch: "y" },
        { id: "decision-approve", from: "decision", to: "approve", kind: "sequence", branch: "n" },
      ];
    });
    try {
      const { document, Event } = dom.window;
      expect(document.querySelectorAll('.topbar [data-action="open-run"]')).toHaveLength(1);
      expect(document.querySelector('.toolbar [data-action="open-run"]')).toBeNull();
      expect(document.querySelector('.node[data-node-id="review"] .node-route-summary')?.textContent).toContain("AI");
      expect(document.querySelector('.node[data-node-id="decision"] .condition-route')?.textContent).toContain("AI 자동");

      document.querySelector<HTMLButtonElement>('.topbar [data-action="open-run"]')?.click();
      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("현재 프로젝트 추천");
      expect(dialog?.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="repo:current-project"]')?.checked).toBe(true);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="model"]')?.value).toBe("gpt-5.6-sol");
      expect(dialog?.querySelectorAll(".run-route-row")).toHaveLength(0);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-condition"]')).toBeNull();
      expect(dialog?.textContent).toContain("조건 분기는 실행 중 자동 판정");
      expect(dialog?.textContent).not.toContain("실제 실행 전에 조건 분기를 선택하십시오");
      expect(dialog?.textContent).not.toContain("실행 프로젝트나 세션이 지정되지 않았습니다");
      expect(dialog?.textContent).not.toContain("checkpoint를 권장합니다");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(false);

      expect(dialog?.textContent).not.toContain("노드별 실행 대상");
    } finally {
      dom.window.close();
    }
  });

  it("does not offer Claude-unsupported reasoning for a new session", async () => {
    const dom = await mountPanel(({ store }) => {
      store.graphs[0].defaults = { projectId: "project", model: "claude-opus-5" };
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="show-analysis"]')?.click();
      const select = document.querySelector<HTMLSelectElement>('[data-scope="graph-routing"][data-field="reasoning"]');
      expect([...select?.options ?? []].map((option) => option.value)).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
    } finally {
      dom.window.close();
    }
  });

  it("sanitizes hidden existing-session reasoning overrides before execution", async () => {
    const dom = await mountPanel(({ store, targets }) => {
      targets.sessions = [{
        id: "claude-session",
        title: "Claude session",
        worktreeId: "fake-worktree",
        paneKey: "tab:leaf",
        agentType: "claude",
        agentState: "done",
        writable: true,
        connected: true,
      }];
      const graph = store.graphs[0];
      graph.defaults = { sessionId: "claude-session", model: "claude-opus-5", reasoning: "ultra" };
      graph.edges = [];
      graph.nodes = [{
        id: "work", kind: "task", label: "Work", x: 0, y: 0, status: "pending", joinMode: "all",
        task: { id: "task-work", title: "Work", prompt: "work" },
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="show-analysis"]')?.click();
      const select = document.querySelector<HTMLSelectElement>('[data-scope="graph-routing"][data-field="reasoning"]');
      expect([...select?.options ?? []].map((option) => option.value)).toEqual(["", "ultra"]);
      expect(select?.selectedOptions[0]?.textContent).toContain("적용 불가");
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).not.toContain("기존 세션에는 reasoning override를 적용할 수 없습니다");
      expect(dialog?.textContent).not.toContain("Reasoning");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it("supports keyboard graph selection, dialog focus lifecycle, and live announcements", async () => {
    const dom = await mountProductionPanel();
    const { document } = dom.window;
    try {
      const node = document.querySelector<HTMLElement>('[data-node-id][role="button"]');
      expect(node).not.toBeNull();
      expect(node?.getAttribute("tabindex")).toBe("0");
      expect(node?.getAttribute("aria-label")).toMatch(/노드.+상태/u);
      if (!node) return;
      node.focus();
      key(dom, node, "Enter");
      let currentNode = document.querySelector<HTMLElement>(`[data-node-id="${node.dataset.nodeId}"]`);
      expect(currentNode?.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(currentNode);
      const beforeMove = currentNode?.style.left;
      if (currentNode) key(dom, currentNode, "ArrowRight");
      currentNode = document.querySelector<HTMLElement>(`[data-node-id="${node.dataset.nodeId}"]`);
      expect(currentNode?.style.left).not.toBe(beforeMove);
      expect(document.activeElement).toBe(currentNode);
      if (currentNode) key(dom, currentNode, "Escape");
      currentNode = document.querySelector<HTMLElement>(`[data-node-id="${node.dataset.nodeId}"]`);
      expect(currentNode?.getAttribute("aria-pressed")).toBe("false");
      expect(document.activeElement).toBe(currentNode);
      const secondNode = document.querySelectorAll<HTMLElement>('[data-node-id][role="button"]')[1];
      secondNode?.focus();
      if (secondNode) key(dom, secondNode, " ");
      const currentSecondNode = document.querySelector<HTMLElement>(`[data-node-id="${secondNode?.dataset.nodeId}"]`);
      expect(currentSecondNode?.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(currentSecondNode);

      const edge = document.querySelector<SVGGElement>('[data-edge-id][role="button"]');
      expect(edge).not.toBeNull();
      expect(edge?.getAttribute("tabindex")).toBe("0");
      expect(edge?.getAttribute("aria-label")).toContain("연결");
      if (!edge) return;
      edge.focus();
      key(dom, edge, " ");
      let currentEdge = document.querySelector<SVGGElement>(`[data-edge-id="${edge.dataset.edgeId}"]`);
      expect(currentEdge?.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(currentEdge);
      if (currentEdge) key(dom, currentEdge, "Escape");
      currentEdge = document.querySelector<SVGGElement>(`[data-edge-id="${edge.dataset.edgeId}"]`);
      expect(currentEdge?.getAttribute("aria-pressed")).toBe("false");
      expect(document.activeElement).toBe(currentEdge);
      const secondEdge = document.querySelectorAll<SVGGElement>('[data-edge-id][role="button"]')[1];
      secondEdge?.focus();
      if (secondEdge) key(dom, secondEdge, "Enter");
      const currentSecondEdge = document.querySelector<SVGGElement>(`[data-edge-id="${secondEdge?.dataset.edgeId}"]`);
      expect(currentSecondEdge?.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(currentSecondEdge);
      if (currentSecondEdge) key(dom, currentSecondEdge, "Delete");
      expect(document.querySelector(`[data-edge-id="${secondEdge?.dataset.edgeId}"]`)).toBeNull();

      const minimapAction = document.querySelector<HTMLButtonElement>('[data-action="toggle-minimap"]');
      minimapAction?.focus();
      if (minimapAction) {
        key(dom, minimapAction, "Enter");
        minimapAction.click();
      }
      expect(document.activeElement).toBe(document.querySelector('[data-action="toggle-minimap"]'));

      const layoutActions = [...document.querySelectorAll<HTMLButtonElement>('[data-action="toggle-layout"]')];
      const layoutAction = layoutActions[0];
      layoutAction?.focus();
      if (layoutAction) {
        key(dom, layoutAction, " ");
        layoutAction.click();
      }
      expect(document.activeElement).toBe(document.querySelectorAll('[data-action="toggle-layout"]')[0]);

      const runOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-run"]')];
      const runOpener = runOpeners[0];
      expect(runOpener).toBeDefined();
      runOpener?.focus();
      runOpener?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.getAttribute("aria-modal")).toBe("true");
      expect(dialog?.getAttribute("aria-labelledby")).toBe("modal-title");
      expect(document.activeElement).toBe(dialog?.querySelector("[data-modal-initial-focus]"));

      const dialogFocusables = dialog ? focusables(dialog) : [];
      const first = dialogFocusables[0];
      const last = dialogFocusables.at(-1);
      last?.focus();
      if (last) key(dom, last, "Tab");
      expect(document.activeElement).toBe(first);
      if (first) key(dom, first, "Tab", true);
      expect(document.activeElement).toBe(last);
      const currentRunOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-run"]')];
      const currentRunOpener = currentRunOpeners[0];
      currentRunOpener?.focus();
      if (currentRunOpener) key(dom, currentRunOpener, "Tab");
      expect(document.activeElement).toBe(first);
      if (last) key(dom, last, "Escape");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const restoredRunOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-run"]')];
      expect(document.activeElement).toBe(restoredRunOpeners[0]);

      expect(document.querySelector('[data-action="open-plan"]')).toBeNull();

      document.querySelector<HTMLButtonElement>('[data-action="show-analysis"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="copy-graph-id"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.querySelector('.toast[role="status"][aria-live="polite"]')).not.toBeNull();
      expect(document.querySelector('footer.bottom-status[role="status"][aria-live="polite"][aria-atomic="true"]')).not.toBeNull();
      expect(document.querySelector('.topbar [role="status"][aria-live="polite"]')).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("supports multi-selection, full history, edge reconnection, and a read-only run view", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event, MouseEvent } = dom.window;
      document.querySelector<HTMLElement>('.node[data-node-id="node-design"]')?.click();
      document.querySelector<HTMLElement>('.node[data-node-id="node-quality"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
      expect(document.querySelectorAll(".node.selected")).toHaveLength(2);
      expect(document.querySelector(".inspector")?.textContent).toContain("다중 선택");
      expect(document.querySelectorAll("button[data-connect-port]").length).toBeGreaterThanOrEqual(16);

      document.querySelector<HTMLButtonElement>('[data-action="align-selection"][data-id="left"]')?.click();
      expect(document.querySelector<HTMLElement>('.node[data-node-id="node-design"]')?.style.left).toBe("48px");
      expect(document.querySelector<HTMLElement>('.node[data-node-id="node-quality"]')?.style.left).toBe("48px");
      document.querySelector<HTMLButtonElement>('[data-action="undo"]:not([disabled])')?.click();
      expect(document.querySelector<HTMLElement>('.node[data-node-id="node-quality"]')?.style.left).toBe("340px");
      document.querySelector<HTMLButtonElement>('[data-action="redo"]:not([disabled])')?.click();
      expect(document.querySelector<HTMLElement>('.node[data-node-id="node-quality"]')?.style.left).toBe("48px");

      document.querySelector<SVGGElement>('[data-edge-id="edge-1"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const targetNode = document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="to"]');
      expect(targetNode).not.toBeNull();
      expect([...document.querySelectorAll<HTMLOptionElement>('[data-scope="edge"][data-field="kind"] option')].map((item) => item.value)).not.toContain("loop");
      const sourceNode = document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="from"]');
      if (sourceNode) {
        sourceNode.value = "node-quality";
        sourceNode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="from"]')?.value).toBe("node-design");
      const reconnectTarget = document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="to"]');
      if (reconnectTarget) {
        reconnectTarget.value = "node-quality-graph-call";
        reconnectTarget.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="to"]')?.value).toBe("node-quality-graph-call");
      document.querySelector<HTMLButtonElement>('[data-action="undo"]:not([disabled])')?.click();
      document.querySelector<SVGGElement>('[data-edge-id="edge-1"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(document.querySelector<HTMLSelectElement>('[data-scope="edge-endpoint"][data-field="to"]')?.value).toBe("node-quality");

      document.querySelector<HTMLButtonElement>('[data-action="editor-mode"][data-id="run"]')?.click();
      document.querySelector<HTMLElement>('.node[data-node-id="node-design"]')?.click();
      const label = document.querySelector<HTMLInputElement>('[data-scope="node"][data-field="label"]');
      if (label) {
        label.value = "바뀌면 안 됨";
        label.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLElement>('.node[data-node-id="node-design"] .node-title')?.textContent).toBe("요구사항 설계");
      const beforeCount = document.querySelectorAll(".node").length;
      document.querySelector<HTMLButtonElement>('[data-action="add-task"]')?.click();
      expect(document.querySelectorAll(".node")).toHaveLength(beforeCount);
      expect(document.querySelector(".toast")?.textContent).toContain("설계 모드");
    } finally {
      dom.window.close();
    }
  });

  it("opens the node editor from a real pointer selection and links to full Task editing", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event, MouseEvent } = dom.window;
      const node = document.querySelector<HTMLElement>('.node[data-node-id="node-design"]');
      expect(node?.getAttribute("aria-label")).toContain("클릭하면 Task 편집");
      node?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));
      dom.window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX: 80, clientY: 80 }));

      expect(document.querySelector(".inspector.closed")).toBeNull();
      expect(document.querySelector('.inspector[data-inspector-kind="node"]')).not.toBeNull();
      expect(document.querySelector(".inspector")?.textContent).not.toContain("그래프 설정");
      expect(document.querySelector(".inspector .graph-tabs")).toBeNull();
      expect(document.querySelector(".inspector-head")?.textContent).toContain("Task 편집 · 요구사항 설계");
      expect(document.querySelector('[data-action="inspector-tab"][data-id="task"]')?.classList.contains("active")).toBe(true);
      expect(document.querySelector('[data-inspector-panel="task"]')?.textContent).toContain("Task 내용");
      expect(document.querySelector('[data-inspector-panel="task"]')?.textContent).toContain("사람 Draft");
      expect(document.querySelector('[data-inspector-panel="task"]')?.textContent).toContain("Meta Draft");
      expect(document.querySelector('[data-inspector-panel="task"]')?.textContent).toContain("Orca 실행 대상");
      expect(document.querySelectorAll('[data-scope="node-routing"][data-field="projectId"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-scope="node-routing"][data-field="sessionId"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-scope="node-routing"][data-field="model"]')).toHaveLength(1);
      expect(document.querySelector('[data-inspector-panel="task"] [data-scope="local-task"][data-field="metaDraft"]')).not.toBeNull();
      const nodeDraft = document.querySelector<HTMLTextAreaElement>('[data-inspector-panel="task"] [data-scope="local-task"][data-field="draft"]');
      expect(nodeDraft?.value).toContain("요구사항을 분석");
      if (nodeDraft) {
        nodeDraft.value = "노드에서 직접 수정한 사람 Draft";
        nodeDraft.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLTextAreaElement>('[data-inspector-panel="task"] [data-scope="local-task"][data-field="draft"]')?.value).toBe("노드에서 직접 수정한 사람 Draft");
      const nodeModel = document.querySelector<HTMLSelectElement>('[data-inspector-panel="task"] [data-scope="node-routing"][data-field="model"]');
      if (nodeModel) {
        nodeModel.value = "gpt-5.6-luna";
        nodeModel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLSelectElement>('[data-inspector-panel="task"] [data-scope="node-routing"][data-field="model"]')?.value).toBe("gpt-5.6-luna");
      expect(document.querySelector('.node.selected [data-action="edit-node"]')?.textContent).toContain("편집");

      document.querySelector<HTMLButtonElement>('[data-action="show-analysis"]')?.click();
      expect(document.querySelector('.inspector[data-inspector-kind="graph"]')).not.toBeNull();
      expect(document.querySelector(".inspector")?.textContent).toContain("그래프 설정");
      expect(document.querySelector(".inspector")?.textContent).not.toContain("Task 편집 · 요구사항 설계");
      expect(document.querySelectorAll(".node.selected")).toHaveLength(0);

      document.querySelector<HTMLButtonElement>('.node[data-node-id="node-design"] [data-action="edit-node"]')?.click();
      expect(document.querySelector('.inspector[data-inspector-kind="node"]')).not.toBeNull();
      document.querySelector<HTMLButtonElement>('[data-action="edit-managed-task"]')?.click();
      expect(document.querySelector(".inspector")).toBeNull();
      expect(document.querySelector('[aria-label="Task 상세"]')?.textContent).toContain("요구사항 설계");
      expect(document.querySelector('[aria-label="Task 관리"]')).toBeNull();
      expect(document.querySelector<HTMLInputElement>('[data-scope="local-task"][data-field="title"]')?.value).toBe("요구사항 설계");
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector('[aria-label="Task 상세"]')).not.toBeNull();
      document.querySelector<HTMLButtonElement>('[data-action="back-to-task-list"]')?.click();
      expect(document.querySelector('[aria-label="Task 상세"]')).toBeNull();
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("요구사항 설계");
    } finally {
      dom.window.close();
    }
  });

  it("separates graph lifecycle from run health and can close a stale running record", async () => {
    const dom = await mountPanel(({ store }) => {
      const graph = store.graphs[0];
      graph.status = "running";
      graph.nodes.forEach((node: Record<string, unknown>) => { node.status = "pending"; });
      graph.runs = [{
        id: "run-stale", runNo: 9, status: "running", startedAt: "2020-01-01T00:00:00.000Z", trigger: "manual",
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="list"]')?.click();
      const badges = [...document.querySelectorAll<HTMLElement>(".graph-row-badges .badge")].map((item) => item.textContent);
      expect(badges).toContain("상태 · 실행 플래그 남음");
      expect(badges).toContain("최근 실행 · 확인 필요");
      expect(document.querySelector(".graph-status-dot.run-stale")).not.toBeNull();

      document.querySelector<HTMLButtonElement>('[data-action="clear-stale-run"]')?.click();
      const updatedBadges = [...document.querySelectorAll<HTMLElement>(".graph-row-badges .badge")].map((item) => item.textContent);
      expect(updatedBadges).toContain("상태 · 초안");
      expect(updatedBadges).toContain("최근 실행 · 취소");
      expect(document.querySelector('[data-action="clear-stale-run"]')).toBeNull();
      expect(document.querySelector(".toast")?.textContent).toContain("취소로 마감");
    } finally {
      dom.window.close();
    }
  });

  it("navigates graph calls and exposes groups, problems, search, and semantic zoom", async () => {
    const dom = await mountPanel();
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLElement>('.node[data-node-id="node-quality-graph-call"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="inspector-tab"][data-id="task"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-child-graph"]')?.click();
      expect(document.querySelector<HTMLSelectElement>('[data-action="switch-graph"]')?.value).toBe("graph-quality-check");
      expect(document.querySelector(".graph-trail")?.textContent).toContain("Orca 그래프 엔지니어링");
      document.querySelector<HTMLButtonElement>('.graph-trail [data-action="open-trail-graph"]')?.click();
      expect(document.querySelector<HTMLSelectElement>('[data-action="switch-graph"]')?.value).toBe("graph-orca-demo");

      const group = document.querySelector<HTMLSelectElement>('[data-action="group-mode"]');
      if (group) {
        group.value = "superstep";
        group.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector<HTMLSelectElement>('[data-action="group-mode"]')?.value).toBe("superstep");
      expect(document.querySelectorAll(".graph-group").length).toBeGreaterThan(0);

      document.querySelector<HTMLButtonElement>('[data-action="toggle-problems"]')?.click();
      expect(document.querySelector(".problems-panel")).not.toBeNull();
      const search = document.querySelector<HTMLInputElement>('[data-action="node-search"]');
      if (search) {
        search.value = "승인";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      expect(document.querySelectorAll(".node.search-match").length).toBeGreaterThan(0);
      expect([...document.querySelectorAll(".node.search-match .node-title")].some((node) => node.textContent?.includes("승인"))).toBe(true);
      for (let index = 0; index < 6; index += 1) document.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')?.click();
      expect(document.querySelector("[data-canvas]")?.classList.contains("zoom-overview")).toBe(true);
    } finally {
      dom.window.close();
    }
  });
});

describe("work process and branch execution surface", () => {

  it("assigns one graph by project without exposing node-by-node routing", async () => {
    const now = "2026-08-10T00:00:00.000Z";
    const host = terminalHost();
    const dom = await mountPanel((bootstrap) => {
      const graph = bootstrap.store.graphs[0];
      graph.defaults = { environmentId: "local", projectId: "project-api", branch: "main", model: "gpt-5.6-sol" };
      graph.nodes = [
        { id: "api-node", kind: "task", label: "API", x: 0, y: 0, status: "pending", joinMode: "all", task: { id: "task-api", title: "API", prompt: "API 수정" } },
        { id: "web-node", kind: "task", label: "Web", x: 260, y: 0, status: "pending", joinMode: "all", task: { id: "task-web", title: "Web", prompt: "Web 수정" } },
      ];
      graph.edges = [{ id: "api-web", from: "api-node", to: "web-node", kind: "sequence" }];
      delete graph.engineering;
      bootstrap.store.tasks = [
        { id: "task-api", title: "API", prompt: "API 수정", draft: "API 수정", promptRevisions: [], status: "ready", priority: "medium", tags: [], projects: [{ id: "api-target", role: "target", locatorKind: "folder", locator: "/workspace/api", label: "API", branch: "main", position: 0 }], createdAt: now, updatedAt: now },
        { id: "task-web", title: "Web", prompt: "Web 수정", draft: "Web 수정", promptRevisions: [], status: "ready", priority: "medium", tags: [], projects: [{ id: "web-target", role: "target", locatorKind: "folder", locator: "/workspace/web", label: "Web", branch: "release", position: 0 }], createdAt: now, updatedAt: now },
      ];
      bootstrap.targets.environments = [{ id: "local", name: "device-a", local: true, connected: true }];
      bootstrap.targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", worktreeId: "wt-api", path: "/workspace/api", branch: "main" },
        { id: "project-web", name: "Web", environmentId: "local", worktreeId: "wt-web", path: "/workspace/web", branch: "release" },
      ];
      bootstrap.targets.branches = [
        { id: "api-main", branch: "main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/workspace/api" },
        { id: "web-release", branch: "release", environmentId: "local", projectId: "project-web", worktreeId: "wt-web", path: "/workspace/web" },
      ];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="run-mode"]');
      expect(mode).not.toBeNull();
      if (mode) { mode.value = "per_project"; mode.dispatchEvent(new Event("change", { bubbles: true })); }
      expect(document.querySelectorAll(".task-project-run-card")).toHaveLength(2);
      expect(document.querySelector("[role=dialog]")?.textContent).not.toContain("노드별 실행 대상");
      document.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const dispatch = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      // 프로젝트마다 자기 워크트리로 간다. 하나의 라우팅으로 접으면 다른 프로젝트의
      // 작업이 엉뚱한 체크아웃에서 돈다.
      expect(dispatch?.executionMode).toBe("per_project");
      expect(dispatch?.targets).toMatchObject([
        { locator: "/workspace/api", projectId: "project-api", branch: "main", worktreeId: "wt-api" },
        { locator: "/workspace/web", projectId: "project-web", branch: "release", worktreeId: "wt-web" },
      ]);
      expect(document.querySelector(".execution-manager")).not.toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("shows the process badge, saved run input, and Orca worktree branches", async () => {
    const dom = await mountPanel((bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
      };
      const graph = bootstrap.store.graphs[0];
      graph.processEnabled = true;
      graph.status = "running";
      graph.defaults = { projectId: "project-1", branch: "refs/heads/main", model: "gpt-5.6-sol" };
      graph.runs = [{
        id: "run-process", runNo: 7, status: "running", startedAt: "2026-08-10T00:00:00Z",
        inputPrompt: "  고객 A\n계약서 검토  ",
      }];
      bootstrap.targets.environments = [{ id: "local", name: "device-a", local: true, connected: true }];
      bootstrap.targets.projects = [{
        id: "project-1", name: "Work", environmentId: "local", repoId: "repo-1",
        worktreeId: "repo-1::/work", path: "/work", branch: "refs/heads/main",
      }];
      bootstrap.targets.branches = [
        { id: "main", branch: "refs/heads/main", environmentId: "local", projectId: "project-1", repoId: "repo-1", worktreeId: "repo-1::/work", path: "/work" },
        { id: "feature", branch: "refs/heads/feature/review", environmentId: "local", projectId: "project-1", repoId: "repo-1", worktreeId: "repo-1::/feature", path: "/feature" },
      ];
    });
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="list"]')?.click();
      expect(document.querySelector(".graph-list-row")?.textContent).toContain("🧭 업무프로세스");
      document.querySelector<HTMLButtonElement>('[data-action="open-list-graph"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      expect(document.querySelector<HTMLSelectElement>('[data-scope="run-process"][data-field="startNewRun"]')?.value).toBe("resume");
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.value).toBe("  고객 A\n계약서 검토  ");
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.readOnly).toBe(true);
      // 프로젝트의 워크트리가 트리에 그대로 나온다 — 고르는 단위가 워크트리다.
      expect([...document.querySelectorAll<HTMLElement>('.run-target-worktree')]
        .map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("feature/review")]));
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="run-process"][data-field="startNewRun"]');
      if (mode) { mode.value = "new"; mode.dispatchEvent(new Event("change", { bubbles: true })); }
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.readOnly).toBe(false);
      expect(document.querySelector(".process-run-input")?.textContent).toContain("업무 입력을 입력하십시오");
      document.querySelector<HTMLButtonElement>('[data-action="close-modal"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-history"]')?.click();
      expect(document.querySelector(".run-input")?.textContent).toBe("  고객 A\n계약서 검토  ");
    } finally {
      dom.window.close();
    }
  });

  it("does not offer an unsupported resume path for a local process graph", async () => {
    const dom = await mountPanel(({ store }) => {
      const graph = store.graphs[0];
      graph.processEnabled = true;
      graph.defaults = { projectId: "project", model: "gpt-5.6-sol" };
      graph.runs = [{
        id: "run-local-active", runNo: 2, status: "running", startedAt: "2026-08-10T00:00:00Z",
        inputPrompt: "이전 로컬 입력",
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      expect(document.querySelector('[data-scope="run-process"][data-field="startNewRun"]')).toBeNull();
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.readOnly).toBe(false);
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.value).toBe("");
      expect(document.querySelector(".process-run-input")?.textContent).toContain("업무 입력을 입력하십시오");
    } finally {
      dom.window.close();
    }
  });
});

describe("structured source work editing", () => {

  it("builds a quick graph locally so it is saved through the one save path", async () => {
    const host = terminalHost();
    const dom = await mountPanel(({ store }) => {
      const now = "2026-08-11T00:00:00.000Z";
      store.tasks = [
        { id: "task-a", title: "1차", prompt: "A", draft: "A", promptRevisions: [], status: "ready", priority: "medium", tags: [], version: 4, createdAt: now, updatedAt: now },
        { id: "task-b", title: "2차", prompt: "B", draft: "B", promptRevisions: [], status: "ready", priority: "medium", tags: [], version: 2, createdAt: now, updatedAt: now },
      ];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-a"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-quick-graph"][data-id="task-a"]')?.click();
      const name = document.querySelector<HTMLInputElement>('[data-action="quick-graph-name"]');
      if (name) { name.value = "검수 흐름"; name.dispatchEvent(new Event("input", { bubbles: true })); }
      document.querySelector<HTMLElement>('[role="dialog"]')
        ?.querySelector<HTMLInputElement>('[data-action="toggle-quick-graph-task"][data-id="task-b"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="confirm-quick-graph"]')?.click();
      await settle(dom);

      // 원천에 별도 quick-create를 요청하지 않는다. 다른 편집과 같은 저장 경로다.
      expect(host.commands).toEqual([]);
      const switcher = document.querySelector<HTMLSelectElement>('[data-action="switch-graph"]');
      expect([...(switcher?.options ?? [])].map((option) => option.textContent)).toContain("검수 흐름");
      const nodes = [...document.querySelectorAll<HTMLElement>(".node[data-node-id]")];
      expect(nodes).toHaveLength(2);
      expect(nodes.map((node) => node.textContent)).toEqual([
        expect.stringContaining("1차"), expect.stringContaining("2차"),
      ]);
      expect(document.querySelector(".topbar .status-pill.warn")?.textContent).toContain("저장 안 됨");

      document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
      await settle(dom);
      const saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      expect(saved.graphs.map((graph: any) => graph.name)).toContain("검수 흐름");
    } finally {
      dom.window.close();
    }
  });


  it("creates or reuses a Todo Task locally and opens its detail", async () => {
    const host = terminalHost();
    const dom = await mountPanel(({ store }) => {
      const now = "2026-08-11T00:00:00.000Z";
      store.tasks = [];
      store.todos = [{
        id: "todo-source", title: "리뷰 반영", notes: "", draft: "리뷰 반영 작업",
        promptRevisions: [], status: "open", priority: "medium", tags: [], version: 3, createdAt: now, updatedAt: now,
      }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="create-task-for-todo"][data-id="todo-source"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      // Task 생성은 다른 편집과 같은 저장 경로를 탄다. 별도 원천 왕복이 없다.
      expect(host.commands.flatMap(decodeCommands).map((entry) => entry.command)).toEqual(["save"]);
      const detail = document.querySelector<HTMLElement>('[aria-label="Task 상세"]');
      expect(detail?.textContent).toContain("리뷰 반영");
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      // 같은 Todo에서 다시 눌러도 새 Task를 만들지 않고 연결된 Task를 연다.
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-linked-task"]')?.click();
      await settle(dom);
      expect(document.querySelector<HTMLElement>('[aria-label="Task 상세"]')?.textContent).toContain("리뷰 반영");
    } finally {
      dom.window.close();
    }
  });


  it("sends each Task target to its own project branch and model session", async () => {
    const now = "2026-08-11T00:00:00.000Z";
    const host = terminalHost();
    const dom = await mountPanel((bootstrap) => {
      bootstrap.store.tasks = [{
        id: "task-multi", title: "다중 대상", prompt: "작업", draft: "작업", promptRevisions: [],
        status: "ready", priority: "medium", tags: [], version: 5, createdAt: now, updatedAt: now,
        projects: [
          { id: "api-target", role: "target", locatorKind: "folder", locator: "/workspace/api", label: "API", branch: "main", position: 0 },
          { id: "web-target", role: "target", locatorKind: "folder", locator: "/workspace/web", label: "Web", branch: "release", position: 1 },
        ],
      }];
      bootstrap.targets.environments = [{ id: "local", name: "device-a", local: true, connected: true }];
      bootstrap.targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", worktreeId: "wt-api", path: "/workspace/api", branch: "main" },
        { id: "project-web", name: "Web", environmentId: "local", worktreeId: "wt-web", path: "/workspace/web", branch: "release" },
      ];
      bootstrap.targets.branches = [
        { id: "api-main", branch: "main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/workspace/api" },
        { id: "web-release", branch: "release", environmentId: "local", projectId: "project-web", worktreeId: "wt-web", path: "/workspace/web" },
      ];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-multi"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-multi"]')?.click();
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-mode"]');
      if (mode) { mode.value = "per_project"; mode.dispatchEvent(new Event("change", { bubbles: true })); }
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const decoded = host.commands.flatMap(decodeCommands);
      expect(decoded.map((entry) => entry.command)).toEqual(["save", "dispatch"]);
      const dispatch = decoded[1]!.payload;
      expect(dispatch.executionMode).toBe("per_project");
      expect(dispatch.targets).toMatchObject([
        { locator: "/workspace/api", projectId: "project-api", branch: "main", worktreeId: "wt-api" },
        { locator: "/workspace/web", projectId: "project-web", branch: "release", worktreeId: "wt-web" },
      ]);
      // 프롬프트에는 대상 프로젝트가 그대로 실려야 세션이 어디서 무엇을 할지 안다.
      expect(dispatch.prompt).toContain("/workspace/api");
      expect(dispatch.prompt).toContain("/workspace/web");
    } finally {
      dom.window.close();
    }
  });

  it("does not auto-select a recommendation when the Task already has a target project", async () => {
    const dom = await mountPanel((bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { taskMutation: true },
      };
    });
    try {
      Object.defineProperty(dom.window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          return Response.json({ ok: true, value: {
            taskId: request.taskId, taskVersion: 4, environment: "device-a",
            current: { repoId: "repo-current", path: "/workspace/current", branch: "main" },
            projects: [{ role: "target", locatorKind: "folder", locator: "/workspace/already", position: 0 }],
            recommended: [{
              name: "Current", path: "/workspace/current", environment: "device-a", repo_id: "repo-current",
              worktrees: [{ id: "wt-current", path: "/workspace/current", branch: "main", is_main: true }],
            }],
            registry: [{
              name: "Current", path: "/workspace/current", environment: "device-a", repo_id: "repo-current",
              worktrees: [{ id: "wt-current", path: "/workspace/current", branch: "main", is_main: true }],
            }],
          } });
        }),
      });
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.querySelector<HTMLInputElement>('[data-action="toggle-task-project"]:checked')).toBeNull();
    } finally {
      dom.window.close();
    }
  });


  it("sends only the changed items, each carrying its last-read CAS version", async () => {
    const now = "2026-08-11T00:00:00.000Z";
    const host = terminalHost();
    const dom = await mountPanel((bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready",
        source: { id: "workspace", name: "Workspace" },
        capabilities: { graphCommit: true, domainMutation: true, milestoneMutation: true, taskMutation: true, todoMutation: true, promptMutation: true },
        catalog: [],
      };
      bootstrap.store.tasks = [
        { id: "task-edited", title: "수정 대상", prompt: "A", draft: "A", promptRevisions: [], status: "ready", priority: "medium", tags: [], version: 7, createdAt: now, updatedAt: now },
        { id: "task-untouched", title: "그대로", prompt: "B", draft: "B", promptRevisions: [], status: "ready", priority: "medium", tags: [], version: 2, createdAt: now, updatedAt: now },
      ];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-edited"]')?.click();
      const title = document.querySelector<HTMLInputElement>('[data-scope="local-task"][data-field="title"]');
      if (title) {
        title.value = "수정한 제목";
        title.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      // 손대지 않은 항목을 함께 보내면 그 사이 원천에서 바뀐 값을 덮어쓰게 된다.
      expect(saved.tasks.map((task: any) => task.id)).toEqual(["task-edited"]);
      expect(saved.tasks[0]).toMatchObject({ title: "수정한 제목", version: 7 });
      expect(saved.todos).toBeUndefined();
      expect(saved.domains).toBeUndefined();
    } finally {
      dom.window.close();
    }
  });

  it("runs where the checked project is, not where a stale saved route points", async () => {
    // 저장해 둔 실행 설정의 routing과 체크한 프로젝트가 어긋나 있으면, 창은 A를
    // 체크한 채 B로 보낸다. 사용자에게는 "고른 프로젝트가 먹지 않는다"로 보인다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ store, targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [
        { id: "project-current", name: "current", environmentId: "local", repoId: "repo-current", worktreeId: "wt-current", path: "/src/current", branch: "refs/heads/main", current: true },
        { id: "project-chosen", name: "chosen", environmentId: "local", repoId: "repo-chosen", worktreeId: "wt-chosen", path: "/src/chosen", branch: "refs/heads/master" },
      ];
      targets.branches = [
        { id: "local:current", branch: "refs/heads/main", environmentId: "local", projectId: "project-current", repoId: "repo-current", worktreeId: "wt-current", path: "/src/current" },
        { id: "local:chosen", branch: "refs/heads/master", environmentId: "local", projectId: "project-chosen", repoId: "repo-chosen", worktreeId: "wt-chosen", path: "/src/chosen" },
      ];
      store.tasks = [{
        id: "task-routed", title: "라우팅 확인", prompt: "본문", draft: "본문", promptRevisions: [],
        status: "ready", priority: "medium", tags: [],
        createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
        metadata: {
          orcaGraphRunSettings: {
            schemaVersion: 1,
            routing: { environmentId: "local", projectId: "project-current", branch: "main", model: "claude-opus-5" },
            executionMode: "single_session",
            selectedProjectIds: ["project-chosen"],
            projectRoutings: {},
            savedAt: "2026-08-12T00:10:00.000Z",
          },
        },
      }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-routed"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-routed"]')?.click();

      // 창이 말하는 실행 위치부터 체크한 프로젝트와 같아야 한다.
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect([...dialog?.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]:checked') ?? []]
        .map((input) => input.dataset.projectId)).toEqual(["project-chosen"]);
      expect(dialog?.querySelector(".run-route-effective")?.textContent).toContain("chosen");

      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const dispatched = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(dispatched?.targets[0]).toMatchObject({
        projectId: "project-chosen", branch: "master", worktreeId: "wt-chosen",
      });
      // 통합 모델은 그대로 간다. 프로젝트만 선택을 따른다.
      expect(dispatched?.targets[0].modelDefinition).toMatchObject({ id: "claude-opus-5" });
    } finally {
      dom.window.close();
    }
  });

  it("groups run targets by machine, project, and worktree the way Orca shows them", async () => {
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [
        { id: "local", name: "device-a", local: true, connected: true },
        { id: "env-remote", name: "device-b", local: false, connected: true },
      ];
      targets.projects = [
        { id: "project-app", name: "app", environmentId: "local", repoId: "repo-app", worktreeId: "repo-app::/src/app", path: "/src/app", branch: "refs/heads/main", current: true },
        { id: "project-lib", name: "lib", environmentId: "local", repoId: "repo-lib", worktreeId: "repo-lib::/src/lib", path: "/src/lib", branch: "refs/heads/dev" },
        { id: "project-far", name: "far", environmentId: "env-remote", repoId: "repo-far", worktreeId: "repo-far::/far", path: "/far", branch: "refs/heads/main" },
      ];
      targets.branches = [
        { id: "b1", branch: "refs/heads/main", environmentId: "local", projectId: "project-app", worktreeId: "repo-app::/src/app", path: "/src/app", displayName: "main", main: true, active: true, liveTerminals: 2, sortOrder: 1 },
        { id: "b2", branch: "refs/heads/review", environmentId: "local", projectId: "project-app", worktreeId: "repo-app::/src/app-review", path: "/src/app-review", displayName: "review", pinned: true, sortOrder: 2 },
        { id: "b3", branch: "refs/heads/dev", environmentId: "local", projectId: "project-lib", worktreeId: "repo-lib::/src/lib", path: "/src/lib", displayName: "dev", sortOrder: 3 },
        { id: "b4", branch: "refs/heads/main", environmentId: "env-remote", projectId: "project-far", worktreeId: "repo-far::/far", path: "/far", displayName: "main" },
      ];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

      // 머신이 최상위 그룹이고, 이 Orca가 먼저 온다.
      expect([...dialog?.querySelectorAll<HTMLElement>(".run-target-environment > header > strong") ?? []]
        .map((item) => item.textContent)).toEqual(["device-a", "device-b"]);
      // 프로젝트는 활성 프로젝트가 먼저, 워크트리는 핀 → 활성 → sortOrder 순.
      const local = dialog?.querySelector<HTMLElement>(".run-target-environment.active");
      expect([...local?.querySelectorAll<HTMLElement>(".run-target-project > header > strong") ?? []]
        .map((item) => item.textContent)).toEqual(["app", "lib"]);
      expect([...local?.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]') ?? []]
        .map((input) => `${input.dataset.projectId}:${input.dataset.branch}`))
        .toEqual(["project-app:review", "project-app:main", "project-lib:dev"]);
      expect(local?.querySelector(".run-target-worktree")?.textContent).toContain("📌");
      expect(local?.textContent).toContain("⌨ 2");

      // 다른 머신의 워크트리를 고르면 실행 머신이 그쪽으로 옮겨 간다.
      document.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="project-far"]')?.click();
      const machine = document.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="environmentId"]');
      expect(machine?.value).toBe("env-remote");
      expect([...document.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]:checked')]
        .map((input) => input.dataset.projectId)).toEqual(["project-far"]);
    } finally {
      dom.window.close();
    }
  });

  it("gives each selected project its own session and model, and dispatches one per project", async () => {
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/src/api", branch: "refs/heads/main" },
        { id: "project-web", name: "Web", environmentId: "local", repoId: "repo-web", worktreeId: "wt-web", path: "/src/web", branch: "refs/heads/release" },
      ];
      targets.branches = [
        { id: "b-api", branch: "refs/heads/main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/src/api" },
        { id: "b-web", branch: "refs/heads/release", environmentId: "local", projectId: "project-web", worktreeId: "wt-web", path: "/src/web" },
      ];
      targets.sessions = [{
        id: "term_web", title: "Web Codex", environmentId: "local", worktreeId: "wt-web", projectId: "project-web",
        branch: "refs/heads/release", paneKey: "web:1", agentType: "codex", agentState: "done", connected: true, writable: true,
      }];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();

      document.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="project-api"]')?.click();
      document.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="project-web"]')?.click();
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-mode"][data-field="executionMode"]');
      expect(mode).not.toBeNull();
      if (mode) {
        mode.value = "per_project";
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // 프로젝트별을 고르면 카드가 프로젝트 수만큼 생기고, 각 카드가 자기 세션·모델을 가진다.
      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelectorAll(".task-project-run-card")).toHaveLength(2);
      const models = [...dialog?.querySelectorAll<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="model"]') ?? []];
      expect(models).toHaveLength(2);
      const apiModel = models.find((select) => select.dataset.locator === "/src/api");
      if (apiModel) {
        apiModel.value = "claude-opus-5";
        apiModel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const webMode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="targetMode"][data-locator="/src/web"]');
      if (webMode) {
        webMode.value = "session";
        webMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const webSession = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="sessionId"][data-locator="/src/web"]');
      expect(webSession?.value).toBe("term_web");

      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const dispatched = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(dispatched?.executionMode).toBe("per_project");
      // 선택한 프로젝트마다 하나씩, 각자의 설정으로 나간다.
      expect(dispatched?.targets).toHaveLength(2);
      expect(dispatched?.targets.find((target: any) => target.projectId === "project-api")).toMatchObject({
        worktreeId: "wt-api", modelDefinition: { id: "claude-opus-5", agent: "claude" },
      });
      expect(dispatched?.targets.find((target: any) => target.projectId === "project-web")).toMatchObject({
        sessionId: "term_web",
      });
    } finally {
      dom.window.close();
    }
  });

  it("carries the whole graph definition so the session never looks it up elsewhere", async () => {
    // 노드 목록만 보내면 세션은 각 노드가 무엇을 시키는지 알 수 없어, 그래프 정의를
    // 바깥 저장소에서 찾다가 실패한다. 실제로 "Work Tasks에 그 그래프가 없다"며 멈췄다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [{ id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/src/api", branch: "refs/heads/main", current: true }];
      targets.branches = [{ id: "b-api", branch: "refs/heads/main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/src/api" }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const prompt = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload.prompt as string;
      expect(prompt).toContain("이 id로 다른 저장소나 도구를 조회하지 마십시오");
      // 각 노드의 지시문이 그대로 실려야 세션이 그래프를 수행할 수 있다.
      expect(prompt).toContain("요구사항을 분석하고");
      expect(prompt).toContain("승인된 설계를 구현하고");
      // 조건 노드는 판정 기준과 분기가 함께 실린다.
      expect(prompt).toContain("판정 기준:");
      expect(prompt).toMatch(/분기 y → /u);
      expect(prompt).toContain("NODE <노드 id> running");
    } finally {
      dom.window.close();
    }
  });

  it("tells each target the truth about where and on what it runs", async () => {
    // 프로젝트별 실행은 대상마다 프로젝트·브랜치·모델이 다르다. 프롬프트가 한 벌이면
    // 두 번째 대상부터는 자기 것이 아닌 실행 컨텍스트를 사실로 읽는다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/src/api", branch: "refs/heads/main" },
        { id: "project-web", name: "Web", environmentId: "local", repoId: "repo-web", worktreeId: "wt-web", path: "/src/web", branch: "refs/heads/release" },
      ];
      targets.branches = [
        { id: "b-api", branch: "refs/heads/main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/src/api" },
        { id: "b-web", branch: "refs/heads/release", environmentId: "local", projectId: "project-web", worktreeId: "wt-web", path: "/src/web" },
      ];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      document.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="project-api"]')?.click();
      document.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-project-id="project-web"]')?.click();
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-mode"][data-field="executionMode"]');
      if (mode) {
        mode.value = "per_project";
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const webModel = document.querySelector<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="model"][data-locator="/src/web"]');
      if (webModel) {
        webModel.value = "claude-opus-5";
        webModel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const dispatched = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      const api = dispatched.targets.find((target: any) => target.projectId === "project-api");
      const web = dispatched.targets.find((target: any) => target.projectId === "project-web");
      expect(api.prompt).toContain("- project: API");
      expect(api.prompt).toContain("- model: gpt-5.6-sol");
      expect(web.prompt).toContain("- project: Web");
      expect(web.prompt).toContain("- model: claude-opus-5");
      expect(web.prompt).not.toContain("gpt-5.6-sol");
    } finally {
      dom.window.close();
    }
  });

  it("does not claim a model when the run goes into a session it did not start", async () => {
    // 기존 세션의 모델은 플러그인이 정하지 않는다. 그런데도 모델 이름을 적으면
    // 세션은 자기가 아닌 모델을 사실로 읽고, 자기소개 같은 작업이 그대로 틀린다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [{ id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/src/api", branch: "refs/heads/main", current: true }];
      targets.branches = [{ id: "b-api", branch: "refs/heads/main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/src/api" }];
      targets.sessions = [{
        id: "term_live", title: "Live Codex", environmentId: "local", worktreeId: "wt-api",
        projectId: "project-api", branch: "refs/heads/main", paneKey: "a:1", agentType: "codex",
        agentState: "done", connected: true, writable: true,
      }];
    }, host.configure);
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      const targetMode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="targetMode"]');
      if (targetMode) {
        targetMode.value = "session";
        targetMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const dispatched = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(dispatched.prompt).toContain("이 세션에서 이미 돌고 있는 에이전트");
      expect(dispatched.prompt).not.toContain("- model: gpt-5.6-sol");
    } finally {
      dom.window.close();
    }
  });

  it("launches new sessions without approval prompts unless the run says otherwise", async () => {
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [{ id: "project-app", name: "app", environmentId: "local", repoId: "repo-app", worktreeId: "wt-app", path: "/src/app", branch: "refs/heads/main", current: true }];
      targets.branches = [{ id: "b-app", branch: "refs/heads/main", environmentId: "local", projectId: "project-app", worktreeId: "wt-app", path: "/src/app" }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();

      // 사람이 지켜보지 않는 세션이므로 승인 우회가 기본이다.
      const toggle = document.querySelector<HTMLInputElement>('[data-action="toggle-task-run-auto-approve"]');
      expect(toggle?.checked).toBe(true);
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);
      expect(host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload.targets[0].autoApprove).toBe(true);

      // 실행 후에는 실행 현황으로 넘어간다. Task로 돌아와 다시 연다.
      host.commands.length = 0;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      document.querySelector<HTMLInputElement>('[data-action="toggle-task-run-auto-approve"]')?.click();
      expect(document.querySelector<HTMLInputElement>('[data-action="toggle-task-run-auto-approve"]')?.checked).toBe(false);
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);
      expect(host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload.targets[0].autoApprove).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it("keeps saved per-project settings for a Task that has no target projects", async () => {
    // Task에 대상 프로젝트를 붙이지 않고 트리에서 직접 고른 경우다. 저장해 둔
    // 프로젝트별 설정을 잃으면 창은 고른 프로젝트마다 "사용할 수 없습니다"라고
    // 말하고 실행 버튼이 잠긴다 — 고친 것이 그 상황이다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ store, targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [
        { id: "project-plan", name: "plan", environmentId: "local", repoId: "repo-plan", worktreeId: "wt-plan", path: "/src/plan", branch: "refs/heads/master" },
        { id: "project-work", name: "work", environmentId: "local", repoId: "repo-work", worktreeId: "wt-work", path: "/src/work", branch: "refs/heads/dev" },
      ];
      targets.branches = [
        { id: "b-plan", branch: "refs/heads/master", environmentId: "local", projectId: "project-plan", worktreeId: "wt-plan", path: "/src/plan" },
        { id: "b-work", branch: "refs/heads/dev", environmentId: "local", projectId: "project-work", worktreeId: "wt-work", path: "/src/work" },
      ];
      store.tasks = [{
        id: "task-two", title: "두 프로젝트", prompt: "본문", draft: "본문", promptRevisions: [],
        status: "ready", priority: "medium", tags: [],
        createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
        metadata: {
          orcaGraphRunSettings: {
            schemaVersion: 1,
            routing: { environmentId: "local", model: "claude-opus-5" },
            executionMode: "per_project",
            selectedProjectIds: ["project-plan", "project-work"],
            projectRoutings: {
              "/src/plan": { environmentId: "local", projectId: "project-plan", branch: "master", model: "gpt-5.6-sol" },
              "/src/work": { environmentId: "local", projectId: "project-work", branch: "dev", model: "gpt-5.6-sol" },
            },
            savedAt: "2026-08-12T00:10:00.000Z",
          },
        },
      }];
    }, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-two"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-two"]')?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).not.toContain("선택한 Orca 프로젝트를 사용할 수 없습니다");
      expect(dialog?.querySelector(".run-configuration-errors")).toBeNull();
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);
      expect(dialog?.querySelectorAll(".task-project-run-card")).toHaveLength(2);

      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const dispatched = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(dispatched?.executionMode).toBe("per_project");
      expect(dispatched?.targets.map((target: any) => target.worktreeId).sort()).toEqual(["wt-plan", "wt-work"]);
    } finally {
      dom.window.close();
    }
  });

  it("comes back to the screen it was on, not the canvas", async () => {
    // 패널에는 저장소가 없어 다시 열면 처음 화면(캔버스)으로 돌아간다. 저장할 때
    // 지금 화면을 함께 남겨 두고, 다음에 열 때 그 화면으로 돌아간다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(undefined, host.configure);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="new-local-task"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
      await settle(dom);
      await waitForCommands(host, 1);

      const saved = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "save")?.payload;
      expect(saved.panelView).toMatchObject({ mode: "tasks" });
      dom.window.close();
    } finally {
      // 위에서 닫았다면 두 번 닫아도 안전하다.
    }

    // 다음에 열 때 그 화면으로 돌아온다.
    const reopened = await mountPanel(({ store }) => {
      store.panelView = { mode: "tasks", selectedTaskId: "task-design", taskDetailOpen: true };
    });
    try {
      expect(reopened.window.document.querySelector('[aria-label="Task 상세"]')).not.toBeNull();
      expect(reopened.window.document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.classList.contains("active")).toBe(true);
    } finally {
      reopened.window.close();
    }
  });

  it("forgets a session that has since closed instead of blocking every node", async () => {
    // 그래프 기본값에는 지난 실행에서 고른 세션 id가 남는다. 그 세션이 닫히면 모든
    // 노드가 "선택한 세션을 사용할 수 없습니다"로 막히고, 어디를 고쳐야 하는지도
    // 알 수 없다 — 살아 있지 않은 세션은 지정하지 않은 것으로 본다.
    const dom = await mountPanel(({ store, targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [{ id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/src/api", branch: "refs/heads/main", current: true }];
      targets.branches = [{ id: "b-api", branch: "refs/heads/main", environmentId: "local", projectId: "project-api", worktreeId: "wt-api", path: "/src/api" }];
      targets.sessions = [];
      store.graphs[0].defaults = {
        environmentId: "local", projectId: "project-api", branch: "main",
        sessionId: "term_closed_yesterday", model: "gpt-5.6-sol",
      };
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).not.toContain("세션을 사용할 수 없습니다");
      expect(dialog?.querySelector(".run-configuration-errors")).toBeNull();
      // 세션 대신 워크트리로 돌아간다 — 그 프로젝트에서 새 세션을 연다.
      expect(dialog?.querySelector(".run-route-effective")?.textContent).toContain("새 세션 · API");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it("says what to do when this device has never read its Orca targets", async () => {
    // 새로 설치한 장치의 상태다. 대상 파일이 없어 패널은 패키지 기본값(프로젝트 0)을
    // 싣고 열린다. 그 상태에서 "현재 컨텍스트로 실행을 시도한다"는 안내는 거짓이다 —
    // 고를 워크트리도 세션도 없으므로 보내면 반드시 실패한다.
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "local", local: true, connected: true }];
      targets.projects = [];
      targets.branches = [];
      targets.sessions = [];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelectorAll('[data-action="toggle-run-worktree"]')).toHaveLength(0);
      expect(dialog?.textContent).toContain("Orca 대상 갱신");
      expect(dialog?.textContent).not.toContain("현재 Orca 컨텍스트로 실행을 시도합니다");
    } finally {
      dom.window.close();
    }
  });

  it("sends a Task to a chosen worktree and a Graph to a live session", async () => {
    // 요구사항 두 가지를 한 번에 확인한다. 이 Orca의 프로젝트·워크트리·세션을
    // 고를 수 있어야 하고, 고른 것이 실제로 보낼 수 있는 대상으로 나가야 한다.
    const host = terminalHost([{ id: "shell" }]);
    const dom = await mountPanel(({ targets }) => {
      targets.environments = [{ id: "local", name: "this-device", local: true, connected: true }];
      targets.projects = [{
        id: "github:me/app", name: "app", environmentId: "local", repoId: "repo-app",
        worktreeId: "repo-app::/src/app", path: "/src/app", branch: "refs/heads/main", current: true,
      }];
      targets.branches = [
        { id: "local:main", branch: "refs/heads/main", environmentId: "local", projectId: "github:me/app", repoId: "repo-app", worktreeId: "repo-app::/src/app", path: "/src/app" },
        { id: "local:review", branch: "refs/heads/review", environmentId: "local", projectId: "github:me/app", repoId: "repo-app", worktreeId: "repo-app::/src/app-review", path: "/src/app-review" },
      ];
      targets.sessions = [{
        id: "term_live", title: "Live Claude", environmentId: "local", worktreeId: "repo-app::/src/app",
        projectId: "github:me/app", branch: "refs/heads/main", paneKey: "tab:leaf",
        agentType: "claude", agentState: "done", connected: true, writable: true,
      }];
    }, host.configure);
    try {
      const { document, Event } = dom.window;

      // Task — 이 장치의 프로젝트를 고르고, 그 프로젝트의 다른 워크트리로 보낸다.
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect([...dialog?.querySelectorAll<HTMLElement>(".run-target-project > header > strong") ?? []]
        .map((option) => option.textContent)).toEqual(["app"]);
      // 프로젝트 아래에 워크트리가 그대로 나열되고, 고르는 단위가 워크트리다.
      expect([...dialog?.querySelectorAll<HTMLInputElement>('[data-action="toggle-run-worktree"]') ?? []]
        .map((input) => input.dataset.branch)).toEqual(["main", "review"]);
      dialog?.querySelector<HTMLInputElement>('[data-action="toggle-run-worktree"][data-branch="review"]')?.click();
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const taskDispatch = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(taskDispatch?.itemKind).toBe("task");
      // 고른 워크트리가 그대로 나가야 세션이 그 체크아웃에서 열린다.
      expect(taskDispatch?.targets[0]).toMatchObject({
        projectId: "github:me/app", branch: "review", worktreeId: "repo-app::/src/app-review",
      });
      expect(taskDispatch?.targets[0].modelDefinition).toMatchObject({ id: "gpt-5.6-sol", agent: "codex" });

      // Graph — 이미 떠 있는 세션으로 보낸다. 이때는 새 세션을 만들지 않는다.
      host.commands.length = 0;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="canvas"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-run"]')?.click();
      const targetMode = document.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="targetMode"]');
      if (targetMode) {
        targetMode.value = "session";
        targetMode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="sessionId"]')?.value).toBe("term_live");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(false);
      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.click();
      await settle(dom);
      await waitForCommands(host, 2);

      const graphDispatch = host.commands.flatMap(decodeCommands).find((entry) => entry.command === "dispatch")?.payload;
      expect(graphDispatch?.itemKind).toBe("graph");
      expect(graphDispatch?.targets[0]).toMatchObject({ sessionId: "term_live" });
      expect(graphDispatch?.targets[0].worktreeId).toBeUndefined();
    } finally {
      dom.window.close();
    }
  });
});
