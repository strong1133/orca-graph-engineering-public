import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const root = process.cwd();
const execFileAsync = promisify(execFile);
let productionPanelHtml: Promise<string> | null = null;

function configureWindow(wide: boolean): (window: DOMWindow) => void {
  return (window) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: wide ? 1200 : 640 });
    Object.defineProperty(window, "structuredClone", { configurable: true, value: structuredClone });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe(): void {}
        disconnect(): void {}
      },
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: () => "00000000-0000-4000-8000-000000000000",
    });
    if (wide) (window as typeof window & { __ORCA_GRAPH_WIDE_API__?: string }).__ORCA_GRAPH_WIDE_API__ = "/test/api";
  };
}

function panelBootstrapScript(value: unknown): string {
  const encoded = JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<script id="orca-graph-bootstrap" type="application/json">${encoded}</script>`;
}

async function mountPanel(
  wide: boolean,
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
      configureWindow(wide)(window);
      configureDom?.(window);
    },
  });
  await Promise.resolve();
  return dom;
}

async function mountProductionPanel(wide: boolean): Promise<JSDOM> {
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
    beforeParse: configureWindow(wide),
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

describe.each([
  ["side panel", false],
  ["wide view", true],
] as const)("panel accessibility in %s", (_label, wide) => {
  it("manages local Tasks and Todos without a connected data source", async () => {
    const dom = await mountPanel(wide);
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
      document.querySelector<HTMLButtonElement>('[data-action="promote-todo"]')?.click();
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
    const dom = await mountPanel(wide, ({ store }) => {
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
    const dom = await mountPanel(wide, ({ store, targets }) => {
      store.bridgeWorkspace = "current-project";
      targets.environments = [
        { id: "local", name: "jsj1", local: true, connected: true },
        { id: "environment-jsj2", name: "jsj2", local: false, connected: true },
      ];
      targets.projects = [
        { id: "repo:current-project", name: "current-project", environmentId: "local", worktreeId: "worktree-current-project" },
        { id: "repo:remote-project", name: "remote-project", environmentId: "environment-jsj2", worktreeId: "worktree-remote-project" },
      ];
      targets.sessions = [{
        id: "remote-session", title: "Remote Codex", environmentId: "environment-jsj2",
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
      expect(opener?.textContent).toContain("워크트리 빠른 실행");
      opener?.click();

      let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Task 워크트리 빠른 실행");
      expect(dialog?.textContent).toContain("그래프 run이나 노드 claim을 만들지 않고");
      expect(dialog?.textContent).toContain("현재 Orca 워크트리 자동 선택");
      const environment = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="environmentId"]');
      expect(environment?.value).toBe("local");
      expect([...(environment?.options ?? [])].map((option) => option.textContent)).toEqual(["jsj1 · 이 Orca", "jsj2"]);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="projectId"]')?.value).toBe("repo:current-project");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]')?.value).toBe("gpt-5.6-sol");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);

      const model = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="model"]');
      if (model) {
        model.value = "claude-opus-5";
        model.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Claude Opus 5");
      expect([...dialog?.querySelectorAll<HTMLOptionElement>('[data-scope="task-run-routing"][data-field="reasoning"] option') ?? []]
        .map((option) => option.value)).toEqual(["", "low", "medium", "high", "xhigh", "max"]);

      const rerenderedEnvironment = dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="environmentId"]');
      if (rerenderedEnvironment) {
        rerenderedEnvironment.value = "environment-jsj2";
        rerenderedEnvironment.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect([...dialog?.querySelectorAll<HTMLOptionElement>('[data-scope="task-run-routing"][data-field="projectId"] option') ?? []]
        .map((option) => option.textContent)).toEqual(["프로젝트 미지정", "remote-project"]);
      expect([...dialog?.querySelectorAll<HTMLOptionElement>('[data-scope="task-run-routing"][data-field="sessionId"] option') ?? []]
        .map((option) => option.textContent)).toEqual(["세션 미지정 · 새 세션", "Remote Codex · remote-project"]);
    } finally {
      dom.window.close();
    }
  });

  it("opens Todo and Task quick-run buttons on an Orca worktree", async () => {
    const dom = await mountPanel(wide, ({ store, targets }) => {
      store.bridgeWorkspace = "current-project";
      store.todos = [{
        id: "todo-quick-run", title: "빠른 실행 Todo", notes: "", draft: "Todo 작업 실행",
        promptRevisions: [], status: "open", priority: "medium", tags: [],
        createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
      }];
      targets.projects = [{
        id: "repo:current-project", name: "current-project", environmentId: "local",
        worktreeId: "worktree-current-project", branch: "refs/heads/feature/quick-run",
      }];
      targets.branches = [{
        id: "branch:quick-run", branch: "refs/heads/feature/quick-run", environmentId: "local",
        projectId: "repo:current-project", repoId: "repo-current-project", worktreeId: "worktree-current-project",
      }];
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector<HTMLButtonElement>('[aria-label^="Task 워크트리 빠른 실행"]')).not.toBeNull();

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      const listQuickRun = document.querySelector<HTMLButtonElement>('[aria-label^="Todo 워크트리 빠른 실행"]');
      expect(listQuickRun).not.toBeNull();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-todo"]')?.click();
      const detailQuickRun = document.querySelector<HTMLButtonElement>('.work-inspector [data-action="open-todo-run"]');
      expect(detailQuickRun?.textContent).toContain("워크트리 빠른 실행");
      detailQuickRun?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Task 워크트리 빠른 실행");
      expect(dialog?.textContent).toContain("그래프 run이나 노드 claim을 만들지 않고");
      expect(document.querySelector<HTMLSelectElement>('[data-scope="local-todo"][data-field="taskId"]')?.value).not.toBe("");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="projectId"]')?.value)
        .toBe("repo:current-project");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="task-run-routing"][data-field="branch"]')?.value)
        .toBe("feature/quick-run");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.disabled).toBe(false);
    } finally {
      dom.window.close();
    }
  });

  it("offers a confirmed Task delete action that preserves recoverable history", async () => {
    const dom = await mountPanel(wide);
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      const deleteButton = document.querySelector<HTMLButtonElement>('[data-action="open-task-delete"]');
      const deletedTaskId = deleteButton?.dataset.id;
      expect(deleteButton?.textContent).toBe("Task 삭제");
      expect(deleteButton?.classList.contains("danger")).toBe(true);
      deleteButton?.click();

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("영구 삭제하지 않고 보관 상태로 전환");
      expect(dialog?.textContent).toContain("Prompt 이력");
      dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-task-delete"]')?.click();

      expect(document.querySelector<HTMLElement>('[role="dialog"]')).toBeNull();
      expect(document.querySelector<HTMLElement>('[aria-label="Task 상세"]')).toBeNull();
      expect(document.querySelector<HTMLElement>('[aria-label="Task 관리"]')).not.toBeNull();
      expect(document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.classList.contains("active")).toBe(true);
      const archivedCard = [...document.querySelectorAll<HTMLButtonElement>('[data-action="select-local-task"]')]
        .find((item) => item.dataset.id === deletedTaskId);
      expect(archivedCard).not.toBeUndefined();
      expect(archivedCard?.textContent).toContain("보관");
      archivedCard?.click();
      expect(document.querySelector<HTMLButtonElement>('[data-action="archive-local-task"]')?.textContent).toBe("Task 복원");
    } finally {
      dom.window.close();
    }
  });

  it("keeps each management menu active after its own mutations", async () => {
    const dom = await mountPanel(wide);
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
    const dom = await mountPanel(wide, (bootstrap) => {
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
    const dom = await mountPanel(wide);
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

  it("keeps human Draft and Meta Draft separate and exposes explicit skill generation", async () => {
    const dom = await mountPanel(wide, ({ store }) => {
      const now = "2026-08-09T00:00:00.000Z";
      store.tasks = [{
        id: "task-prompt", title: "Prompt task", prompt: "old meta", draft: "human request", metaDraft: "old meta",
        promptRevisions: [
          { id: "draft-1", kind: "draft", revision: 1, content: "human request", status: "current", generator: "human", createdAt: now },
          { id: "meta-2", kind: "meta", revision: 2, content: "old meta", status: "current", basedOnId: "draft-1", generator: "meta-prompt-agent", createdAt: now },
        ],
        status: "ready", priority: "medium", tags: [], createdAt: now, updatedAt: now,
      }];
    });
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-prompt"]')?.click();
      const draft = document.querySelector<HTMLTextAreaElement>('[data-scope="local-task"][data-field="draft"]');
      const meta = document.querySelector<HTMLTextAreaElement>(".prompt-editor.meta");
      expect(draft?.value).toBe("human request");
      expect(meta?.value).toBe("old meta");
      expect(meta?.readOnly).toBe(true);
      expect(document.querySelector('[data-action="request-meta-prompt"]')?.textContent).toContain("다시 만들기");
      if (draft) {
        draft.value = "changed human request";
        draft.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelector(".prompt-pair")?.textContent).toContain("원문 변경됨");
      expect(document.querySelector(".prompt-history")?.textContent).toContain("Prompt 이력 3");
    } finally {
      dom.window.close();
    }
  });

  it("renders condition nodes as real diamonds with size-aware edges", async () => {
    const dom = await mountProductionPanel(wide);
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
    const dom = await mountPanel(wide);
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
    const dom = await mountPanel(wide, (bootstrap) => {
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
      document.querySelector<HTMLButtonElement>('[data-action="open-plan"]')?.click();
      const runDialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(runDialog?.textContent).toContain("실행 상태는 원천이 소유합니다");
      expect(runDialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it("blocks model/bridge policy errors in the run modal", async () => {
    const dom = await mountPanel(wide, ({ store }) => {
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
    const dom = await mountPanel(wide, ({ store, targets }) => {
      store.bridgeWorkspace = "current-project";
      targets.projects = [{ id: "repo:current-project", name: "current-project", worktreeId: "worktree-current-project" }];
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
      expect(dialog?.textContent).toContain("현재 브리지 작업공간 자동 선택");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="projectId"]')?.value).toBe("repo:current-project");
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="model"]')?.value).toBe("gpt-5.6-sol");
      expect(dialog?.querySelectorAll(".run-route-row")).toHaveLength(4);
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-condition"]')?.value).toBe("");
      expect(dialog?.textContent).toContain("실행 중 AI가 선행 결과로 자동 판정");
      expect(dialog?.textContent).not.toContain("실제 실행 전에 조건 분기를 선택하십시오");
      expect(dialog?.textContent).not.toContain("실행 프로젝트나 세션이 지정되지 않았습니다");
      expect(dialog?.textContent).not.toContain("checkpoint를 권장합니다");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(false);

      const nodeModel = dialog?.querySelector<HTMLSelectElement>('[data-scope="run-node-routing"][data-node-id="review"][data-field="model"]');
      if (nodeModel) {
        nodeModel.value = "claude-opus-5";
        nodeModel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector<HTMLSelectElement>('[data-scope="run-node-routing"][data-node-id="review"][data-field="model"]')?.value).toBe("claude-opus-5");
      expect(dialog?.querySelector('.run-route-row[data-run-node-id="review"]')?.textContent).toContain("Claude Opus 5");
    } finally {
      dom.window.close();
    }
  });

  it("does not offer Claude-unsupported reasoning for a new session", async () => {
    const dom = await mountPanel(wide, ({ store }) => {
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

  it("exposes and blocks existing-session reasoning overrides", async () => {
    const dom = await mountPanel(wide, ({ store, targets }) => {
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
      document.querySelector<HTMLButtonElement>('[data-action="open-plan"]')?.click();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("기존 세션에는 reasoning override를 적용할 수 없습니다");
      expect(dialog?.querySelector<HTMLButtonElement>('[data-action="confirm-run"]')?.disabled).toBe(true);
    } finally {
      dom.window.close();
    }
  });

  it("supports keyboard graph selection, dialog focus lifecycle, and live announcements", async () => {
    const dom = await mountProductionPanel(wide);
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
      const runOpener = runOpeners[wide ? 0 : 1] ?? runOpeners[0];
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
      const currentRunOpener = currentRunOpeners[wide ? 0 : 1] ?? currentRunOpeners[0];
      currentRunOpener?.focus();
      if (currentRunOpener) key(dom, currentRunOpener, "Tab");
      expect(document.activeElement).toBe(first);
      if (last) key(dom, last, "Escape");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const restoredRunOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-run"]')];
      expect(document.activeElement).toBe(restoredRunOpeners[wide ? 0 : 1] ?? restoredRunOpeners[0]);

      const selectedClose = document.querySelector<HTMLButtonElement>('[data-action="clear-selection"]');
      selectedClose?.click();
      const planOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-plan"]')];
      const planOpener = planOpeners[wide ? 0 : 1] ?? planOpeners[0];
      planOpener?.focus();
      planOpener?.click();
      document.querySelector<HTMLButtonElement>('[role="dialog"] [data-action="close-modal"]')?.click();
      const restoredPlanOpeners = [...document.querySelectorAll<HTMLButtonElement>('[data-action="open-plan"]')];
      expect(document.activeElement).toBe(restoredPlanOpeners[wide ? 0 : 1] ?? restoredPlanOpeners[0]);

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
    const dom = await mountPanel(wide);
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
    const dom = await mountPanel(wide);
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
      expect(document.querySelector('[data-action="request-meta-prompt"]')).not.toBeNull();
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
    const dom = await mountPanel(wide, ({ store }) => {
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
    const dom = await mountPanel(wide);
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
  it("shows the process badge, saved run input, and Orca worktree branches", async () => {
    const dom = await mountPanel(true, (bootstrap) => {
      const graph = bootstrap.store.graphs[0];
      graph.processEnabled = true;
      graph.status = "running";
      graph.defaults = { projectId: "project-1", branch: "refs/heads/main", model: "gpt-5.6-sol" };
      graph.runs = [{
        id: "run-process", runNo: 7, status: "running", startedAt: "2026-08-10T00:00:00Z",
        inputPrompt: "  고객 A\n계약서 검토  ",
      }];
      bootstrap.targets.environments = [{ id: "local", name: "jsj1", local: true, connected: true }];
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
      const branch = document.querySelector<HTMLSelectElement>('[data-scope="run-routing"][data-field="branch"]');
      expect([...branch!.options].map((item) => item.textContent)).toContain("feature/review · /feature");
      const mode = document.querySelector<HTMLSelectElement>('[data-scope="run-process"][data-field="startNewRun"]');
      if (mode) { mode.value = "new"; mode.dispatchEvent(new Event("change", { bubbles: true })); }
      expect(document.querySelector<HTMLTextAreaElement>('[data-scope="run-process"][data-field="inputPrompt"]')?.readOnly).toBe(false);
      expect(document.querySelector(".process-run-input")?.textContent).toContain("업무 입력이 필요합니다");
      document.querySelector<HTMLButtonElement>('[data-action="close-modal"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-history"]')?.click();
      expect(document.querySelector(".run-input")?.textContent).toBe("  고객 A\n계약서 검토  ");
    } finally {
      dom.window.close();
    }
  });
});

describe("structured source work editing", () => {
  it("refreshes an embedded side panel through the bridge response API", async () => {
    const now = "2026-08-10T00:00:00.000Z";
    const requests: any[] = [];
    let refreshedStore: Record<string, any> | null = null;
    const dom = await mountPanel(false, (bootstrap) => {
      bootstrap.store.tasks = [{
        id: "TASK-refresh", version: 3, title: "새로고침 전", prompt: "work", draft: "work",
        promptRevisions: [], status: "backlog", priority: "medium", tags: [], createdAt: now, updatedAt: now,
      }];
      (bootstrap as typeof bootstrap & { bridgeApiUrl: string; dataSource: Record<string, unknown> }).bridgeApiUrl =
        "http://127.0.0.1:61234/test/api";
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { taskMutation: true },
      };
      refreshedStore = structuredClone(bootstrap.store);
      refreshedStore.tasks[0].title = "새로고침 후";
      refreshedStore.tasks[0].version = 4;
    }, (window) => {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          requests.push(request);
          return Response.json({ ok: true, value: {
            mode: "structured", status: "ready", catalog: [], store: refreshedStore,
          } });
        }),
      });
    });
    try {
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("새로고침 전");
      document.querySelector<HTMLButtonElement>('.topbar [data-action="refresh-source"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests).toContainEqual({ type: "refresh-source", graphId: expect.any(String) });
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("새로고침 후");
      expect(document.querySelector('.toast[role="status"]')?.textContent).toContain("데이터 원천을 새로고침했습니다");
    } finally {
      dom.window.close();
    }
  });

  it("creates a quick graph with the last-read Task CAS version and ordered IDs", async () => {
    const now = "2026-08-10T00:00:00.000Z";
    const requests: any[] = [];
    let createdStore: Record<string, any> | null = null;
    const dom = await mountPanel(true, (bootstrap) => {
      bootstrap.store.tasks = [
        { id: "TASK-source", version: 4, title: "Source", prompt: "source prompt", draft: "source prompt", promptRevisions: [], domainId: "DOMAIN-a", milestoneId: "MILESTONE-a", status: "ready", priority: "medium", tags: [], createdAt: now, updatedAt: now },
        { id: "TASK-next", version: 2, title: "Next", prompt: "next prompt", draft: "next prompt", promptRevisions: [], domainId: "DOMAIN-a", milestoneId: "MILESTONE-a", status: "backlog", priority: "medium", tags: [], createdAt: now, updatedAt: now },
      ];
      (bootstrap as typeof bootstrap & { bridgeApiUrl: string; dataSource: Record<string, unknown> }).bridgeApiUrl = "/test/api";
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { graphCommit: true, taskMutation: true },
      };
      createdStore = structuredClone(bootstrap.store);
      const quick = { ...structuredClone(createdStore.graphs[0]), id: "GRAPH-quick", name: "검수 흐름", version: 1, nodes: [], edges: [] };
      createdStore.graphs.push(quick);
      createdStore.activeGraphId = quick.id;
    }, (window) => {
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          requests.push(request);
          if (request.type === "task-project-context") {
            return Response.json({ ok: true, value: {
              taskId: "TASK-source", taskVersion: 9, projects: [], registry: [], recommended: [],
              environment: "정석맥1", current: null,
            } });
          }
          if (request.type === "create-quick-graph") {
            return Response.json({ ok: true, value: { graphId: "GRAPH-quick", store: createdStore } });
          }
          return Response.json({ ok: true, value: undefined });
        }),
      });
    });
    try {
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="TASK-source"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector<HTMLButtonElement>('[data-action="open-quick-graph"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="toggle-quick-graph-task"][data-id="TASK-next"]')?.click();
      const name = document.querySelector<HTMLInputElement>('[data-action="quick-graph-name"]');
      if (name) {
        name.value = "검수 흐름";
        name.dispatchEvent(new Event("input", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="confirm-quick-graph"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requests.find((request) => request.type === "create-quick-graph")).toEqual({
        type: "create-quick-graph",
        sourceTaskId: "TASK-source",
        expectedTaskVersion: 9,
        name: "검수 흐름",
        taskIds: ["TASK-source", "TASK-next"],
      });
      expect(document.querySelector<HTMLElement>('[role="dialog"]')).toBeNull();
      expect(document.querySelector<HTMLSelectElement>(".graph-switcher")?.value).toBe("GRAPH-quick");
    } finally {
      dom.window.close();
    }
  });

  it("creates or reuses a Task before opening Todo quick run", async () => {
    let preparedStore: Record<string, any> | null = null;
    const dom = await mountPanel(true, (bootstrap) => {
      const now = "2026-08-10T00:00:00.000Z";
      bootstrap.store.tasks = [];
      bootstrap.store.todos = [{
        id: "TODO-quick", version: 8, title: "  원문 Todo  ", notes: "메모", draft: "  원문 Todo  ",
        promptRevisions: [], status: "open", priority: "medium", tags: [],
        createdAt: now, updatedAt: now,
      }];
      bootstrap.targets.projects = [{
        id: "repo:work", name: "work", path: "/workspace/work", environmentId: "local",
        worktreeId: "wt-main", branch: "refs/heads/main",
      }];
      bootstrap.targets.branches = [{
        id: "branch:main", branch: "refs/heads/main", environmentId: "local",
        projectId: "repo:work", repoId: "repo-work", worktreeId: "wt-main",
      }];
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { taskMutation: true, todoMutation: true },
      };
      preparedStore = structuredClone(bootstrap.store);
      preparedStore.tasks = [{
        id: "TASK-from-todo", version: 1, title: "원문 Todo", prompt: "  원문 Todo  ", draft: "  원문 Todo  ",
        promptRevisions: [], status: "backlog", priority: "medium", tags: [], createdAt: now, updatedAt: now,
      }];
      preparedStore.todos[0].taskId = "TASK-from-todo";
    });
    try {
      const requests: any[] = [];
      Object.defineProperty(dom.window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          requests.push(request);
          const value = request.type === "prepare-todo-quick-run"
            ? { taskId: "TASK-from-todo", store: preparedStore }
            : request.type === "task-project-context" ? {
                taskId: "TASK-from-todo", taskVersion: 1, projects: [], registry: [], recommended: [],
                environment: "정석맥1", current: null,
              } : undefined;
          return Response.json({ ok: true, value });
        }),
      });
      const { document } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="open-todo-run"][data-id="TODO-quick"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const prepare = requests.find((request) => request.type === "prepare-todo-quick-run");
      expect(prepare).toMatchObject({ type: "prepare-todo-quick-run", todoId: "TODO-quick" });
      expect(prepare.idempotencyKey).toBe("todo-worktree-00000000-0000-4000-8000-000000000000");
      expect(document.querySelector<HTMLElement>('[role="dialog"]')?.textContent).toContain("Task 워크트리 빠른 실행");
      expect(document.querySelector<HTMLElement>('[role="dialog"]')?.textContent).toContain("TASK-from-todo");
    } finally {
      dom.window.close();
    }
  });

  it("selects multiple registered Orca project and actual worktree branch bundles", async () => {
    const dom = await mountPanel(true, (bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { taskMutation: true },
      };
    });
    try {
      const requests: any[] = [];
      Object.defineProperty(dom.window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          requests.push(request);
          if (request.type === "task-project-context") {
            return Response.json({ ok: true, value: {
              taskId: request.taskId, taskVersion: 4, projects: [], environment: "정석맥1",
              current: { repoId: "repo-a", path: "/workspace/a", branch: "refs/heads/main" },
              recommended: [{
                name: "Project A", path: "/workspace/a", environment: "정석맥1", repo_id: "repo-a",
                worktrees: [
                  { id: "wt-feature", path: "/workspace/a-feature", branch: "feature/review", display_name: "review" },
                  { id: "wt-main", path: "/workspace/a", branch: "main", display_name: "main", is_main: true },
                ],
              }],
              registry: [{
                name: "Project A", path: "/workspace/a", environment: "정석맥1", repo_id: "repo-a",
                worktrees: [
                  { id: "wt-feature", path: "/workspace/a-feature", branch: "feature/review", display_name: "review" },
                  { id: "wt-main", path: "/workspace/a", branch: "main", display_name: "main", is_main: true },
                ],
              }, {
                name: "Project B", path: "/workspace/b", environment: "정석맥1", repo_id: "repo-b",
                worktrees: [{ id: "wt-b", path: "/workspace/b", branch: "release", is_main: true }],
              }],
            } });
          }
          if (request.type === "connect-task-project-bundles") {
            return Response.json({ ok: true, value: {
              context: {
                taskId: request.taskId, taskVersion: 5, registry: [], recommended: [], environment: "정석맥1", current: null,
                projects: request.selections.map((selection: any, position: number) => ({
                  role: "target", locatorKind: "folder", locator: selection.targetPath ?? selection.sourcePath,
                  branch: selection.branch || undefined, position,
                })),
              },
            } });
          }
          return Response.json({ ok: true, value: undefined });
        }),
      });
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const projects = [...document.querySelectorAll<HTMLInputElement>('[data-action="toggle-task-project"]')];
      expect(projects).toHaveLength(2);
      expect(projects[0]?.checked).toBe(true);
      expect(projects[0]?.closest("article")?.textContent).toContain("워크트리 2");
      let branch = document.querySelector<HTMLSelectElement>('[data-scope="task-project-picker"][data-field="branch"][data-source-path="/workspace/a"]');
      expect(branch?.value).toBe("main");
      expect([...(branch?.options ?? [])].map((item) => item.textContent)).toEqual([
        "브랜치 지정 안 함", "main · 기본", "feature/review",
      ]);

      projects[1]?.click();
      branch = document.querySelector<HTMLSelectElement>('[data-scope="task-project-picker"][data-field="branch"][data-source-path="/workspace/b"]');
      expect(branch?.value).toBe("release");
      if (branch) {
        branch.value = "";
        branch.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="connect-task-projects"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests.find((request) => request.type === "connect-task-project-bundles")).toMatchObject({
        taskId: "task-design", environment: "정석맥1",
        selections: [
          { sourcePath: "/workspace/a", targetPath: "/workspace/a", branch: "main" },
          { sourcePath: "/workspace/b", targetPath: "/workspace/b", branch: "" },
        ],
      });
    } finally {
      dom.window.close();
    }
  });

  it("runs every Task target in its own project branch and model session", async () => {
    const projectRows = [
      { id: "TP-A", role: "target" as const, locatorKind: "folder" as const, locator: "/workspace/api", label: "API", branch: "main", position: 0 },
      { id: "TP-B", role: "target" as const, locatorKind: "folder" as const, locator: "/workspace/web", label: "Web", branch: "release", position: 1 },
    ];
    const dom = await mountPanel(true, (bootstrap) => {
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: { taskMutation: true },
      };
      bootstrap.store.tasks = [{
        id: "task-design", version: 7, title: "다중 프로젝트 실행", prompt: "API와 Web을 함께 수정",
        draft: "API와 Web을 함께 수정", promptRevisions: [], status: "ready", priority: "medium", tags: [],
        projects: projectRows, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
      }];
      bootstrap.targets.environments = [{ id: "local", name: "jsj1", local: true, connected: true }];
      bootstrap.targets.projects = [
        { id: "project-api", name: "API", environmentId: "local", repoId: "repo-api", worktreeId: "wt-api", path: "/workspace/api", branch: "main" },
        { id: "project-web", name: "Web", environmentId: "local", repoId: "repo-web", worktreeId: "wt-web", path: "/workspace/web", branch: "release" },
      ];
      bootstrap.targets.branches = [
        { id: "branch-api", branch: "main", environmentId: "local", projectId: "project-api", repoId: "repo-api", worktreeId: "wt-api", path: "/workspace/api" },
        { id: "branch-web", branch: "release", environmentId: "local", projectId: "project-web", repoId: "repo-web", worktreeId: "wt-web", path: "/workspace/web" },
      ];
    });
    try {
      const requests: any[] = [];
      Object.defineProperty(dom.window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          const request = JSON.parse(String(init.body));
          requests.push(request);
          if (request.type === "task-project-context") {
            return Response.json({ ok: true, value: {
              taskId: "task-design", taskVersion: 7, projects: projectRows, registry: [], recommended: [],
              environment: "정석맥1", current: null,
            } });
          }
          if (request.type === "link-task-project-bundles") {
            return Response.json({ ok: true, value: {
              context: { taskId: "task-design", taskVersion: 8, projects: projectRows, registry: [], recommended: [], environment: "정석맥1", current: null },
            } });
          }
          if (request.type === "run-task") {
            return Response.json({ ok: true, value: { sessionId: "session-api", sessions: [{ sessionId: "session-api" }, { sessionId: "session-web" }] } });
          }
          return Response.json({ ok: true, value: undefined });
        }),
      });
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-design"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      document.querySelector<HTMLButtonElement>('[data-action="open-task-run"][data-id="task-design"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      let mode = document.querySelector<HTMLSelectElement>('[data-scope="task-run-mode"]');
      expect(mode).not.toBeNull();
      if (mode) {
        mode.value = "per_project";
        mode.dispatchEvent(new Event("change", { bubbles: true }));
      }
      expect(document.querySelectorAll(".task-project-run-card")).toHaveLength(2);
      expect([...document.querySelectorAll<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="branch"]')].map((select) => select.value)).toEqual(["main", "release"]);
      let webModel = document.querySelector<HTMLSelectElement>('[data-scope="task-run-project-routing"][data-field="model"][data-locator="/workspace/web"]');
      if (webModel) {
        webModel.value = "gpt-5.6-luna";
        webModel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.querySelector<HTMLButtonElement>('[data-action="confirm-task-run"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(requests.find((request) => request.type === "link-task-project-bundles")?.bundles).toEqual([
        { path: "/workspace/api", label: "API", branch: "main" },
        { path: "/workspace/web", label: "Web", branch: "release" },
      ]);
      expect(requests.find((request) => request.type === "run-task")).toMatchObject({
        executionMode: "per_project",
        projectSessions: [
          { locator: "/workspace/api", routing: { environmentId: "local", projectId: "project-api", branch: "main", model: "gpt-5.6-sol" } },
          { locator: "/workspace/web", routing: { environmentId: "local", projectId: "project-web", branch: "release", model: "gpt-5.6-luna" } },
        ],
      });
    } finally {
      dom.window.close();
    }
  });

  it("does not auto-select a recommendation when the Task already has a target project", async () => {
    const dom = await mountPanel(true, (bootstrap) => {
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
            taskId: request.taskId, taskVersion: 4, environment: "정석맥1",
            current: { repoId: "repo-current", path: "/workspace/current", branch: "main" },
            projects: [{ role: "target", locatorKind: "folder", locator: "/workspace/already", position: 0 }],
            recommended: [{
              name: "Current", path: "/workspace/current", environment: "정석맥1", repo_id: "repo-current",
              worktrees: [{ id: "wt-current", path: "/workspace/current", branch: "main", is_main: true }],
            }],
            registry: [{
              name: "Current", path: "/workspace/current", environment: "정석맥1", repo_id: "repo-current",
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

  it("sends the last-read CAS version and full supported Task DTO", async () => {
    const dom = await mountPanel(true, (bootstrap) => {
      const now = "2026-08-09T00:00:00.000Z";
      bootstrap.store.tasks = [{
        id: "task-source", version: 4, title: "Source task", prompt: "Human draft", draft: "Human draft",
        promptRevisions: [{
          id: "task-source:draft:1", kind: "draft", revision: 1, content: "Human draft",
          status: "current", generator: "human", createdAt: now,
        }],
        status: "backlog", priority: "medium", tags: [], createdAt: now, updatedAt: now,
      }];
      bootstrap.store.todos = [{
        id: "todo-source", version: 6, title: "Bound Todo", notes: "", draft: "Bound Todo",
        groupName: "Delivery", subgroupName: "Review",
        promptRevisions: [], status: "open", priority: "medium", tags: [], taskId: "task-source",
        createdAt: now, updatedAt: now,
      }];
      (bootstrap as typeof bootstrap & { dataSource: Record<string, unknown> }).dataSource = {
        config: { schemaVersion: 1, mode: "structured", url: "https://example.test/api/" },
        status: "ready", source: { id: "workspace", name: "Workspace" }, catalog: [],
        capabilities: {
          graphCommit: true, domainMutation: true, milestoneMutation: true,
          taskMutation: true, todoMutation: true, promptMutation: true,
        },
      };
    });
    try {
      const requests: any[] = [];
      Object.defineProperty(dom.window, "fetch", {
        configurable: true,
        value: vi.fn(async (_url: string, init: RequestInit) => {
          requests.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ok: true, value: undefined }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }),
      });
      const { document, Event } = dom.window;
      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="tasks"]')?.click();
      expect(document.querySelector('[aria-label="Task 관리"]')?.textContent).toContain("구조화 원천 · 양방향");
      document.querySelector<HTMLButtonElement>('[data-action="select-local-task"][data-id="task-source"]')?.click();
      const title = document.querySelector<HTMLInputElement>('[data-scope="local-task"][data-field="title"]');
      expect(title?.value).toBe("Source task");
      if (title) {
        title.value = "Changed in Orca";
        title.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests.find((request) => request.type === "mutate-source" && request.mutation?.kind === "task")).toMatchObject({
        type: "mutate-source",
        mutation: {
          kind: "task", expectedVersion: 4, relatedVersions: { "todo-source": 6 },
          item: { id: "task-source", title: "Changed in Orca", draft: "Human draft" },
        },
      });

      document.querySelector<HTMLButtonElement>('[data-action="set-view"][data-id="todos"]')?.click();
      const subgroup = document.querySelector<HTMLInputElement>('[data-scope="local-todo"][data-field="subgroupName"]');
      expect(subgroup?.value).toBe("Review");
      if (subgroup) {
        subgroup.value = "Approval";
        subgroup.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(requests.find((request) => request.type === "mutate-source" && request.mutation?.kind === "todo")).toMatchObject({
        type: "mutate-source",
        mutation: {
          kind: "todo", expectedVersion: 6, relatedVersions: { "task-source": 4 },
          item: { id: "todo-source", groupName: "Delivery", subgroupName: "Approval" },
        },
      });
    } finally {
      dom.window.close();
    }
  });
});
