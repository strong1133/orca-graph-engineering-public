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
    beforeParse: configureWindow(wide),
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

describe("structured source work editing", () => {
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
      expect(requests[0]).toMatchObject({
        type: "mutate-source",
        mutation: {
          kind: "task", expectedVersion: 4, relatedVersions: { "todo-source": 6 },
          item: { id: "task-source", title: "Changed in Orca", draft: "Human draft" },
        },
      });
    } finally {
      dom.window.close();
    }
  });
});
