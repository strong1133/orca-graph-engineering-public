import { encodeBridgeFrames } from "./bridge-protocol";
import {
  GRID,
  NODE_HEIGHT,
  NODE_WIDTH,
  TOPOLOGY_TEMPLATES,
  analyzeGraph,
  applyTopologyTemplate,
  autoLayout,
  cloneGraph,
  currentDraftRevision,
  currentMetaRevision,
  effectiveRouting,
  graphCallDefaults,
  modelReasoningLevels,
  newId,
  normalizeGraphStore,
  reasoningRouteError,
  validateGraph,
  validateGraphLinks,
  type Bootstrap,
  type DataSourceCatalogItem,
  type DataSourceConfig,
  type DataSourceState,
  type GraphDefinition,
  type GraphEdge,
  type GraphGroupMode,
  type GraphNode,
  type GraphStore,
  type DomainStatus,
  type LocalDomain,
  type LocalMilestone,
  type LocalTask,
  type LocalTaskStatus,
  type LocalTodo,
  type LocalTodoStatus,
  type MilestoneStatus,
  type NodeKind,
  type OrcaTargets,
  type PromptRevision,
  type RoutingTarget,
  type TopologyKind,
  type WorkPriority,
} from "./model";

type PanelActionResult = {
  type: "orca-panel-action-result";
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  errorCode?: string;
};

type WorkspaceContext = {
  branch: string;
  displayName: string;
  terminals: Array<{ id: string }>;
} | null;

type RunModalState = {
  kind: "run";
  live: boolean;
  defaults: RoutingTarget;
  nodeRouting: Record<string, RoutingTarget>;
  conditionBranches: Record<string, string>;
  suggestedProjectId?: string;
};

type TaskRunModalState = {
  kind: "task-run";
  taskId: string;
  routing: RoutingTarget;
  suggestedProjectId?: string;
};

type ModalState =
  | { kind: "bridge"; loading: boolean; context: WorkspaceContext; error?: string }
  | { kind: "data-source"; error?: string }
  | RunModalState
  | TaskRunModalState
  | { kind: "task-delete"; taskId: string }
  | { kind: "history" }
  | { kind: "templates" }
  | { kind: "shortcuts" }
  | { kind: "batch-tasks"; text: string; error?: string }
  | { kind: "json"; mode: "import" | "export"; text: string; error?: string }
  | null;

type EditorMode = "design" | "run";
type InspectorTab = "basic" | "task" | "execution" | "safety";
type GraphRunStage = "never" | "planned" | "running" | "stale" | "done" | "failed" | "cancelled";
type WorkGroupMode = "none" | "domain" | "milestone" | "todo-group" | "status" | "priority";
type GraphHistoryEntry = {
  graphId: string;
  label: string;
  before: GraphDefinition;
  after: GraphDefinition;
};
type LayoutPreview = { graphId: string; graph: GraphDefinition; nodeIds: string[] };
type QuickCreateState = { x: number; y: number; fromNodeId?: string };
type SelectionBoxState = { startX: number; startY: number; x: number; y: number; additive: boolean };

interface ViewState {
  mode: "canvas" | "list" | "domains" | "milestones" | "tasks" | "todos";
  graphQuery: string;
  graphStatusFilter: GraphDefinition["status"] | "all";
  graphRunFilter: "all" | GraphRunStage;
  graphSort: "updated-desc" | "updated-asc" | "name-asc" | "name-desc" | "status";
  graphFacet: "all" | "pinned" | "routine" | "running";
  includeArchived: boolean;
  workQuery: string;
  taskStatusFilter: LocalTaskStatus | "all";
  todoStatusFilter: LocalTodoStatus | "active" | "all";
  workDomainFilter: string;
  workMilestoneFilter: string;
  taskWorkGroup: WorkGroupMode;
  todoWorkGroup: WorkGroupMode;
  collapsedWorkGroups: Set<string>;
  workSort: "updated-desc" | "due-asc" | "priority" | "title";
  scopeQuery: string;
  nodeQuery: string;
  selectedDomainId: string | null;
  selectedMilestoneId: string | null;
  selectedTaskId: string | null;
  selectedTodoId: string | null;
  taskDetailOpen: boolean;
  layoutDirection: "LR" | "TB";
  showMinimap: boolean;
  alignmentGuides: { x?: number; y?: number };
  historyUndo: GraphHistoryEntry[];
  historyRedo: GraphHistoryEntry[];
  selectedNodeIds: string[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  connectingFrom: string | null;
  connectionPointer: Point | null;
  quickCreate: QuickCreateState | null;
  selectionBox: SelectionBoxState | null;
  layoutPreview: LayoutPreview | null;
  editorMode: EditorMode;
  inspectorTab: InspectorTab;
  problemsOpen: boolean;
  graphTrail: string[];
  inspectorOpen: boolean;
  panX: number;
  panY: number;
  zoom: number;
  dirty: boolean;
  sourceRefreshing: boolean;
  toast: string;
  modal: ModalState;
}

const bootstrapElement = document.querySelector<HTMLScriptElement>("#orca-graph-bootstrap");
if (!bootstrapElement?.textContent) throw new Error("Graph Engineering bootstrap is missing.");
const bootstrap = structuredClone(JSON.parse(bootstrapElement.textContent) as Bootstrap);
const wideApi = (window as Window & { __ORCA_GRAPH_WIDE_API__?: string }).__ORCA_GRAPH_WIDE_API__;
const isWideMode = typeof wideApi === "string" && wideApi.startsWith("/");
let store: GraphStore = normalizeGraphStore(bootstrap.store);
let targets = bootstrap.targets;
let dataSource: DataSourceState = bootstrap.dataSource ?? {
  config: { schemaVersion: 1, mode: "local" },
  status: "idle",
  catalog: [],
  message: "로컬 JSON 저장소를 사용합니다.",
};
if (!store.graphs.length) {
  const now = new Date().toISOString();
  const id = newId("graph");
  store.graphs.push({
    id, name: "새 그래프", summary: "", status: "draft",
    version: dataSource.config.mode === "structured" ? 0 : 1,
    pinned: false, routineEnabled: false, repeatMode: "none", defaults: {},
    runGuards: { claimLeaseSeconds: 21600, stagnationRuns: 3 },
    engineering: { checkpointPolicy: "superstep", requireProvenance: true, humanGateForIrreversible: true, maturity: "experimental" },
    nodes: [], edges: [], runs: [], createdAt: now, updatedAt: now,
  });
  store.activeGraphId = id;
}
const view: ViewState = {
  mode: "canvas",
  graphQuery: "",
  graphStatusFilter: "all",
  graphRunFilter: "all",
  graphSort: "updated-desc",
  graphFacet: "all",
  includeArchived: false,
  workQuery: "",
  taskStatusFilter: "all",
  todoStatusFilter: "active",
  workDomainFilter: "all",
  workMilestoneFilter: "all",
  taskWorkGroup: "milestone",
  todoWorkGroup: "todo-group",
  collapsedWorkGroups: new Set(),
  workSort: "updated-desc",
  scopeQuery: "",
  nodeQuery: "",
  selectedDomainId: null,
  selectedMilestoneId: null,
  selectedTaskId: null,
  selectedTodoId: null,
  taskDetailOpen: false,
  layoutDirection: "LR",
  showMinimap: true,
  alignmentGuides: {},
  historyUndo: [],
  historyRedo: [],
  selectedNodeIds: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  connectingFrom: null,
  connectionPointer: null,
  quickCreate: null,
  selectionBox: null,
  layoutPreview: null,
  editorMode: "design",
  inspectorTab: "basic",
  problemsOpen: false,
  graphTrail: [],
  inspectorOpen: false,
  panX: 28,
  panY: 28,
  zoom: 0.86,
  dirty: false,
  sourceRefreshing: false,
  toast: "",
  modal: null,
};

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) throw new Error("Graph Engineering panel root is missing.");
const app: HTMLElement = appElement;
type ReturnFocus = { action: string; id?: string; occurrence: number };
let modalReturnFocus: ReturnFocus | null = null;
let modalInitialFocusPending = false;
let suppressNextClick = false;

const pendingHostCalls = new Map<string, (result: PanelActionResult) => void>();

window.addEventListener("message", (event) => {
  const data = event.data as Partial<PanelActionResult> | null;
  if (!data || data.type !== "orca-panel-action-result" || !data.requestId) return;
  const resolve = pendingHostCalls.get(data.requestId);
  if (!resolve) return;
  pendingHostCalls.delete(data.requestId);
  resolve(data as PanelActionResult);
});

function hostCall<T>(action: string, params?: unknown): Promise<T> {
  if (isWideMode) {
    if (action === "notifications.show") return Promise.resolve(undefined as T);
    if (action === "workspace.readContext") return Promise.resolve(null as T);
    return Promise.reject(new Error(`${action}은 Orca 사이드바 패널에서만 사용할 수 있습니다.`));
  }
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingHostCalls.delete(requestId);
      reject(new Error(`${action} 응답 시간이 초과되었습니다.`));
    }, 15_000);
    pendingHostCalls.set(requestId, (result) => {
      window.clearTimeout(timer);
      if (result.ok) resolve(result.value as T);
      else reject(new Error(result.error ?? result.errorCode ?? `${action} 실패`));
    });
    window.parent.postMessage(
      { type: "orca-panel-action", requestId, action, ...(params === undefined ? {} : { params }) },
      "*",
    );
  });
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectorEscape(value: string): string {
  return value.replace(/[\\"]/gu, "\\$&");
}

function activeGraph(): GraphDefinition {
  const graph = store.graphs.find((item) => item.id === store.activeGraphId) ?? store.graphs[0];
  if (!graph) throw new Error("그래프가 없습니다.");
  if (store.activeGraphId !== graph.id) store.activeGraphId = graph.id;
  return graph;
}

function selectedNode(graph = activeGraph()): GraphNode | null {
  return graph.nodes.find((node) => node.id === view.selectedNodeId) ?? null;
}

function selectedEdge(graph = activeGraph()): GraphEdge | null {
  return graph.edges.find((edge) => edge.id === view.selectedEdgeId) ?? null;
}

function selectedNodes(graph = activeGraph()): GraphNode[] {
  const ids = new Set(view.selectedNodeIds);
  return graph.nodes.filter((node) => ids.has(node.id));
}

function setNodeSelection(ids: string[], primary = ids.at(-1) ?? null): void {
  const graph = activeGraph();
  const valid = new Set(graph.nodes.map((node) => node.id));
  view.selectedNodeIds = [...new Set(ids.filter((id) => valid.has(id)))];
  view.selectedNodeId = primary && valid.has(primary) ? primary : view.selectedNodeIds.at(-1) ?? null;
  view.selectedEdgeId = null;
  const node = graph.nodes.find((candidate) => candidate.id === view.selectedNodeId);
  if (view.selectedNodeIds.length === 1 && node?.kind === "task" && node.task && store.tasks.some((task) => task.id === node.task?.id)) {
    view.selectedTaskId = node.task.id;
  }
}

function clearGraphSelection(): void {
  view.selectedNodeIds = [];
  view.selectedNodeId = null;
  view.selectedEdgeId = null;
  view.connectingFrom = null;
  view.connectionPointer = null;
  view.quickCreate = null;
}

function graphSnapshot(graph = activeGraph()): GraphDefinition {
  return structuredClone(graph);
}

function replaceGraph(snapshot: GraphDefinition): GraphDefinition {
  const index = store.graphs.findIndex((graph) => graph.id === snapshot.id);
  if (index < 0) throw new Error(`그래프를 찾을 수 없습니다: ${snapshot.id}`);
  const replacement = structuredClone(snapshot);
  if (dataSource.config.mode === "structured") replacement.version = store.graphs[index]!.version;
  else replacement.version = Math.max(store.graphs[index]!.version, replacement.version) + 1;
  replacement.updatedAt = new Date().toISOString();
  store.graphs[index] = replacement;
  store.activeGraphId = replacement.id;
  view.dirty = true;
  return replacement;
}

function recordGraphHistory(before: GraphDefinition, label: string, graph = activeGraph()): void {
  const after = graphSnapshot(graph);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  view.historyUndo.push({ graphId: graph.id, label, before, after });
  if (view.historyUndo.length > 100) view.historyUndo.shift();
  view.historyRedo = [];
}

function undoGraphChange(): void {
  const entry = view.historyUndo.pop();
  if (!entry) { toast("실행취소할 편집이 없습니다."); return; }
  view.historyRedo.push(entry);
  replaceGraph(entry.before);
  clearGraphSelection();
  view.layoutPreview = null;
  render();
  toast(`${entry.label} 실행취소`);
}

function redoGraphChange(): void {
  const entry = view.historyRedo.pop();
  if (!entry) { toast("다시 실행할 편집이 없습니다."); return; }
  view.historyUndo.push(entry);
  replaceGraph(entry.after);
  clearGraphSelection();
  view.layoutPreview = null;
  render();
  toast(`${entry.label} 다시 실행`);
}

function editorPolicy(graph = activeGraph()) {
  graph.engineering ??= {};
  graph.engineering.editor ??= {};
  return graph.engineering.editor;
}

function graphGroupMode(graph = activeGraph()): GraphGroupMode {
  return graph.engineering?.editor?.groupBy ?? "none";
}

const graphStatusLabel: Record<GraphDefinition["status"], string> = {
  draft: "초안",
  active: "활성",
  running: "실행 중",
  done: "완료",
  archived: "보관",
};

function latestRun(graph: GraphDefinition): GraphDefinition["runs"][number] | undefined {
  return graph.runs.reduce<GraphDefinition["runs"][number] | undefined>((latest, run) => {
    if (!latest || run.runNo > latest.runNo) return run;
    if (run.runNo === latest.runNo && run.startedAt > latest.startedAt) return run;
    return latest;
  }, undefined);
}

const STALE_RUN_AFTER_MS = 30 * 60 * 1000;

function graphRunStage(graph: GraphDefinition, now = Date.now()): GraphRunStage {
  const run = latestRun(graph);
  if (!run) return "never";
  if (run.status !== "running") return run.status;
  if (run.endedAt) return "stale";
  const startedAt = Date.parse(run.startedAt);
  const hasActiveNode = graph.nodes.some((node) => node.status === "running" || node.status === "waiting");
  if (!hasActiveNode && Number.isFinite(startedAt) && now - startedAt >= STALE_RUN_AFTER_MS) return "stale";
  return "running";
}

function graphRunLabel(graph: GraphDefinition): string {
  return ({ never: "미실행", planned: "계획됨", running: "실행 중", stale: "확인 필요", done: "성공", failed: "실패", cancelled: "취소" } as const)[graphRunStage(graph)];
}

function graphRunTitle(graph: GraphDefinition): string {
  if (graphRunStage(graph) !== "stale") return `최근 실행: ${graphRunLabel(graph)}`;
  return "원천에는 running으로 남아 있지만 30분 이상 실행 중·대기 노드가 없습니다. 실제 실행 여부를 확인한 뒤 상태를 정리하십시오.";
}

function graphStatusBadgeLabel(graph: GraphDefinition): string {
  if (graph.status === "running" && graphRunStage(graph) === "stale") return "상태 · 실행 플래그 남음";
  return `상태 · ${graphStatusLabel[graph.status]}`;
}

function resetGraphRunState(graph: GraphDefinition): void {
  const now = new Date().toISOString();
  const run = latestRun(graph);
  if (run?.status === "running") {
    run.status = "cancelled";
    run.endedAt = now;
    run.terminationReason = "cancelled";
    run.summary ||= "사용자가 남아 있던 실행 상태를 정리했습니다.";
  }
  graph.nodes.forEach((node) => { node.status = "pending"; delete node.branchTaken; });
  graph.status = "draft";
}

function graphProgress(graph: GraphDefinition): { complete: number; total: number; percent: number } {
  const complete = graph.nodes.filter((node) => node.status === "done" || node.status === "skipped").length;
  const total = graph.nodes.length;
  return { complete, total, percent: total ? Math.round((complete / total) * 100) : 0 };
}

function filteredGraphs(): GraphDefinition[] {
  const query = view.graphQuery.trim().toLocaleLowerCase("ko-KR");
  const statusOrder: Record<GraphDefinition["status"], number> = { running: 0, active: 1, draft: 2, done: 3, archived: 4 };
  const graphs = store.graphs.filter((graph) => {
    if (!view.includeArchived && graph.status === "archived") return false;
    if (view.graphFacet === "pinned" && !graph.pinned) return false;
    if (view.graphFacet === "routine" && !graph.routineEnabled) return false;
    if (view.graphFacet === "running" && graphRunStage(graph) !== "running") return false;
    if (view.graphStatusFilter !== "all" && graph.status !== view.graphStatusFilter) return false;
    if (view.graphRunFilter !== "all" && graphRunStage(graph) !== view.graphRunFilter) return false;
    if (!query) return true;
    return `${graph.name} ${graph.summary} ${graph.id}`.toLocaleLowerCase("ko-KR").includes(query);
  });
  return graphs.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    switch (view.graphSort) {
      case "updated-asc": return left.updatedAt.localeCompare(right.updatedAt);
      case "name-asc": return left.name.localeCompare(right.name, "ko-KR");
      case "name-desc": return right.name.localeCompare(left.name, "ko-KR");
      case "status": return statusOrder[left.status] - statusOrder[right.status] || right.updatedAt.localeCompare(left.updatedAt);
      default: return right.updatedAt.localeCompare(left.updatedAt);
    }
  });
}

const taskStatusLabel: Record<LocalTaskStatus, string> = {
  backlog: "백로그",
  ready: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  done: "완료",
  archived: "보관",
};

const todoStatusLabel: Record<LocalTodoStatus, string> = {
  open: "할 일",
  in_progress: "진행 중",
  done: "완료",
  cancelled: "취소",
};

const priorityLabel: Record<WorkPriority, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  urgent: "긴급",
};

const priorityOrder: Record<WorkPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const domainStatusLabel: Record<DomainStatus, string> = { active: "활성", archived: "보관" };
const milestoneStatusLabel: Record<MilestoneStatus, string> = {
  active: "활성", blocked: "막힘", completed: "완료", archived: "보관",
};

function localWorkMutable(): boolean {
  if (dataSource.config.mode !== "structured") return true;
  const capabilities = dataSource.capabilities;
  return dataSource.status === "ready"
    && Boolean(capabilities?.domainMutation)
    && Boolean(capabilities?.milestoneMutation)
    && Boolean(capabilities?.taskMutation)
    && Boolean(capabilities?.todoMutation);
}

/* 원천이 원격 실행을 여는가. 구조를 모르는 값이나 빈 nodeKinds를 "실행해도 좋다"로
   읽지 않는다 — 이 판정이 틀리면 실행 상태가 두 곳으로 갈라진다. */
function remoteExecution(): { nodeKinds: NodeKind[] } | null {
  if (dataSource.config.mode !== "structured" || dataSource.status !== "ready") return null;
  const execution = dataSource.capabilities?.execution;
  if (!execution || execution.mode !== "remote-claim") return null;
  const nodeKinds = (execution.nodeKinds ?? []).filter((kind): kind is NodeKind =>
    kind === "task" || kind === "condition" || kind === "graph_call");
  return nodeKinds.length ? { nodeKinds } : null;
}

function taskGraphLinks(taskId: string): Array<{ graph: GraphDefinition; node: GraphNode }> {
  return store.graphs.flatMap((graph) => graph.nodes
    .filter((node) => node.task?.id === taskId)
    .map((node) => ({ graph, node })));
}

function touchWorkItem(item: LocalTask | LocalTodo): void {
  item.updatedAt = new Date().toISOString();
  view.dirty = true;
}

function touchScope(item: LocalDomain | LocalMilestone): void {
  if (dataSource.config.mode !== "structured") item.version += 1;
  item.updatedAt = new Date().toISOString();
  view.dirty = true;
}

function domainFor(id: string | undefined): LocalDomain | undefined {
  return id ? store.domains.find((item) => item.id === id) : undefined;
}

function milestoneFor(id: string | undefined): LocalMilestone | undefined {
  return id ? store.milestones.find((item) => item.id === id) : undefined;
}

function itemScope(item: Pick<LocalTask | LocalTodo, "domainId" | "milestoneId">): { domain?: LocalDomain; milestone?: LocalMilestone; label: string } {
  const milestone = milestoneFor(item.milestoneId);
  const domain = domainFor(milestone?.domainId ?? item.domainId);
  return {
    ...(domain ? { domain } : {}),
    ...(milestone ? { milestone } : {}),
    label: [domain?.name, milestone?.name].filter(Boolean).join(" / ") || "독립 항목",
  };
}

function promptState(item: LocalTask | LocalTodo): "running" | "failed" | "current" | "stale" | "missing" {
  if (item.metaPromptRun?.status === "running") return "running";
  if (item.metaPromptRun?.status === "failed") return "failed";
  if (currentMetaRevision(item)) return "current";
  return item.metaDraft ? "stale" : "missing";
}

function nextPromptRevision(item: LocalTask | LocalTodo): number {
  return Math.max(0, ...item.promptRevisions.map((revision) => revision.revision)) + 1;
}

function setHumanDraft(item: LocalTask | LocalTodo, content: string): boolean {
  if (content === item.draft) return false;
  for (const revision of item.promptRevisions) {
    if (revision.kind === "draft" || revision.kind === "meta") revision.status = "stale";
  }
  const now = new Date().toISOString();
  const revision: PromptRevision = {
    id: `${item.id}:draft:${crypto.randomUUID()}`,
    kind: "draft",
    revision: nextPromptRevision(item),
    content,
    status: "current",
    generator: "human",
    createdAt: now,
  };
  item.promptRevisions.push(revision);
  item.draft = content;
  if ("prompt" in item) item.prompt = content;
  touchWorkItem(item);
  return true;
}

function syncTaskToGraphNodes(task: LocalTask): void {
  task.prompt = currentMetaRevision(task)?.content || task.draft;
  const now = new Date().toISOString();
  for (const graph of store.graphs) {
    let changed = false;
    for (const node of graph.nodes) {
      if (node.task?.id !== task.id) continue;
      node.task.title = task.title;
      node.task.prompt = task.prompt;
      if (task.metadata) node.task.metadata = structuredClone(task.metadata);
      else delete node.task.metadata;
      changed = true;
    }
    if (!changed) continue;
    if (dataSource.config.mode !== "structured") graph.version += 1;
    graph.updatedAt = now;
  }
  touchWorkItem(task);
}

function upsertLocalTask(payload: GraphNode["task"], status: LocalTaskStatus = "ready"): LocalTask | null {
  if (!payload) return null;
  const existing = store.tasks.find((task) => task.id === payload.id);
  if (existing) {
    existing.title = payload.title;
    if (payload.prompt !== existing.prompt) setHumanDraft(existing, payload.prompt);
    existing.prompt = currentMetaRevision(existing)?.content || existing.draft;
    if (payload.version !== undefined) existing.version = payload.version;
    else delete existing.version;
    if (payload.metadata) existing.metadata = structuredClone(payload.metadata);
    else delete existing.metadata;
    touchWorkItem(existing);
    return existing;
  }
  const now = new Date().toISOString();
  const task: LocalTask = {
    id: payload.id,
    title: payload.title,
    prompt: payload.prompt,
    draft: payload.prompt,
    promptRevisions: [{
      id: `${payload.id}:draft:${crypto.randomUUID()}`,
      kind: "draft", revision: 1, content: payload.prompt, status: "current", generator: "human", createdAt: now,
    }],
    ...(payload.version !== undefined ? { version: payload.version } : {}),
    ...(payload.metadata ? { metadata: structuredClone(payload.metadata) } : {}),
    status,
    priority: "medium",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  store.tasks.push(task);
  view.dirty = true;
  return task;
}

function workItemMatches(item: { id: string; title: string; tags?: string[]; domainId?: string; milestoneId?: string }, detail = ""): boolean {
  const query = view.workQuery.trim().toLocaleLowerCase("ko-KR");
  if (!query) return true;
  return `${item.id} ${item.title} ${(item.tags ?? []).join(" ")} ${itemScope(item).label} ${detail}`.toLocaleLowerCase("ko-KR").includes(query);
}

function sortWorkItems<T extends { title: string; priority: WorkPriority; dueDate?: string; updatedAt: string }>(items: T[]): T[] {
  return items.sort((left, right) => {
    if (view.workSort === "title") return left.title.localeCompare(right.title, "ko-KR");
    if (view.workSort === "priority") return priorityOrder[left.priority] - priorityOrder[right.priority] || right.updatedAt.localeCompare(left.updatedAt);
    if (view.workSort === "due-asc") return (left.dueDate || "9999-12-31").localeCompare(right.dueDate || "9999-12-31") || right.updatedAt.localeCompare(left.updatedAt);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function touch(graph = activeGraph()): void {
  if (dataSource.config.mode !== "structured") graph.version += 1;
  graph.updatedAt = new Date().toISOString();
  view.dirty = true;
}

function toast(message: string): void {
  view.toast = message;
  render();
  window.setTimeout(() => {
    if (view.toast === message) {
      view.toast = "";
      render();
    }
  }, 2600);
}

function focusableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function returnFocusFor(element: Element | null): ReturnFocus | null {
  const actionElement = element?.closest<HTMLElement>("[data-action]");
  const action = actionElement?.dataset.action;
  if (!action || !actionElement) return null;
  const id = actionElement.dataset.id;
  const matches = [...app.querySelectorAll<HTMLElement>("[data-action]")]
    .filter((candidate) => candidate.dataset.action === action && candidate.dataset.id === id);
  return { action, ...(id ? { id } : {}), occurrence: Math.max(0, matches.indexOf(actionElement)) };
}

function focusReturnTarget(target: ReturnFocus | null): void {
  if (!target) return;
  const matches = [...app.querySelectorAll<HTMLElement>("[data-action]")]
    .filter((candidate) => candidate.dataset.action === target.action && candidate.dataset.id === target.id);
  matches[target.occurrence]?.focus();
}

function openModal(modal: Exclude<ModalState, null>): void {
  if (!view.modal) modalReturnFocus = returnFocusFor(document.activeElement);
  view.modal = modal;
  modalInitialFocusPending = true;
  render();
}

function closeModal(): void {
  const returnFocus = modalReturnFocus;
  view.modal = null;
  modalReturnFocus = null;
  modalInitialFocusPending = false;
  render();
  focusReturnTarget(returnFocus);
}

function option(value: string, label: string, selected: string | undefined): string {
  return `<option value="${esc(value)}"${value === (selected ?? "") ? " selected" : ""}>${esc(label)}</option>`;
}

function routeEnvironmentId(value: string | undefined): string {
  return value || targets.environments?.find((item) => item.local)?.id || "local";
}

function environmentName(id: string | undefined): string {
  const environmentId = routeEnvironmentId(id);
  return targets.environments?.find((item) => item.id === environmentId)?.name ?? (environmentId === "local" ? "local" : environmentId);
}

function projectName(id: string | undefined, environmentId?: string): string {
  if (!id) return "프로젝트 없음";
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return targets.projects.find((item) => item.id === id && routeEnvironmentId(item.environmentId) === targetEnvironmentId)?.name ?? id;
}

function sessionName(id: string | undefined, environmentId?: string): string {
  if (!id) return "세션 없음";
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return targets.sessions.find((item) => item.id === id && routeEnvironmentId(item.environmentId) === targetEnvironmentId)?.title ?? id;
}

function modelName(id: string | undefined): string {
  if (!id) return targets.models.find((item) => item.id === "gpt-5.6-sol")?.label ?? "에이전트 기본 모델";
  return targets.models.find((item) => item.id === id)?.label ?? id;
}

function routingValue(value: RoutingTarget | undefined): RoutingTarget {
  return {
    ...(value?.environmentId ? { environmentId: value.environmentId } : {}),
    ...(value?.projectId ? { projectId: value.projectId } : {}),
    ...(value?.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value?.model ? { model: value.model } : {}),
    ...(value?.reasoning ? { reasoning: value.reasoning } : {}),
  };
}

function createRunModal(live: boolean): RunModalState {
  const graph = activeGraph();
  const defaults = routingValue(graph.defaults);
  let suggestedProjectId: string | undefined;
  if (!defaults.projectId && !defaults.sessionId && store.bridgeWorkspace) {
    const workspace = store.bridgeWorkspace.trim().toLocaleLowerCase("en-US");
    const matches = targets.projects.filter((item) => {
      const id = item.id.toLocaleLowerCase("en-US");
      const name = item.name.toLocaleLowerCase("en-US");
      return id === workspace || name === workspace || id.endsWith(`/${workspace}`);
    });
    if (matches.length === 1) {
      suggestedProjectId = matches[0]!.id;
      defaults.projectId = suggestedProjectId;
    }
  }
  if (!defaults.sessionId && !defaults.model && targets.models.some((item) => item.id === "gpt-5.6-sol")) {
    defaults.model = "gpt-5.6-sol";
  }
  return {
    kind: "run",
    live,
    defaults,
    nodeRouting: Object.fromEntries(graph.nodes.map((node) => [node.id, routingValue(node.routing)])),
    conditionBranches: Object.fromEntries(graph.nodes
      .filter((node) => node.kind === "condition")
      .map((node) => [node.id, node.branchTaken?.trim() ?? ""])),
    ...(suggestedProjectId ? { suggestedProjectId } : {}),
  };
}

function createTaskRunModal(task: LocalTask): TaskRunModalState {
  const routing: RoutingTarget = { environmentId: routeEnvironmentId(undefined) };
  let suggestedProjectId: string | undefined;
  if (store.bridgeWorkspace) {
    const workspace = store.bridgeWorkspace.trim().toLocaleLowerCase("en-US");
    const matches = targets.projects.filter((item) => {
      const id = item.id.toLocaleLowerCase("en-US");
      const name = item.name.toLocaleLowerCase("en-US");
      return routeEnvironmentId(item.environmentId) === routing.environmentId
        && (id === workspace || name === workspace || id.endsWith(`/${workspace}`));
    });
    if (matches.length === 1) {
      suggestedProjectId = matches[0]!.id;
      routing.projectId = suggestedProjectId;
    }
  }
  if (targets.models.some((item) => item.id === "gpt-5.6-sol")) routing.model = "gpt-5.6-sol";
  return {
    kind: "task-run",
    taskId: task.id,
    routing,
    ...(suggestedProjectId ? { suggestedProjectId } : {}),
  };
}

function runDraftGraph(graph: GraphDefinition, modal: RunModalState): GraphDefinition {
  return {
    ...graph,
    defaults: routingValue(modal.defaults),
    nodes: graph.nodes.map((node) => {
      const draft = {
        ...node,
        routing: routingValue(modal.nodeRouting[node.id]),
      };
      if (node.kind === "condition") {
        const branch = modal.conditionBranches[node.id]?.trim();
        if (branch) draft.branchTaken = branch;
        else delete draft.branchTaken;
      }
      return draft;
    }),
  };
}

function applyRunDraft(graph: GraphDefinition, modal: RunModalState): void {
  const before = graphSnapshot(graph);
  graph.defaults = routingValue(modal.defaults);
  for (const node of graph.nodes) {
    const routing = routingValue(modal.nodeRouting[node.id]);
    if (Object.keys(routing).length) node.routing = routing;
    else delete node.routing;
    if (node.kind === "condition") {
      const branch = modal.conditionBranches[node.id]?.trim();
      if (branch) node.branchTaken = branch;
      else delete node.branchTaken;
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(graph)) {
    touch(graph);
    recordGraphHistory(before, "실행 대상 설정", graph);
    view.dirty = true;
  }
}

function graphOptions(selected: string): string {
  return store.graphs
    .filter((graph) => graph.status !== "archived" || graph.id === selected)
    .map((graph) => option(graph.id, `${graph.pinned ? "📌 " : ""}${graph.name}`, selected))
    .join("");
}

function environmentOptions(selected: string | undefined, inherit = false): string {
  const environments = targets.environments?.length
    ? targets.environments
    : [{ id: "local", name: "local", local: true, connected: true }];
  return [
    ...(inherit ? [option("", "그래프 기본값 상속", selected)] : []),
    ...environments.map((item) => option(item.id, `${item.name}${item.local ? " · 이 Orca" : item.connected ? "" : " · 연결 안 됨"}`, selected ?? routeEnvironmentId(undefined))),
  ].join("");
}

function projectOptions(selected: string | undefined, inherit = false, environmentId?: string): string {
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return [
    option("", inherit ? "그래프 기본값 상속" : "프로젝트 미지정", selected),
    ...targets.projects
      .filter((item) => routeEnvironmentId(item.environmentId) === targetEnvironmentId)
      .map((item) => option(item.id, item.name, selected)),
  ].join("");
}

function sessionOptions(selected: string | undefined, inherit = false, environmentId?: string): string {
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return [
    option("", inherit ? "그래프 기본값 상속" : "세션 미지정 · 새 세션", selected),
    ...targets.sessions
      .filter((item) => routeEnvironmentId(item.environmentId) === targetEnvironmentId)
      .map((item) => option(item.id, `${item.title} · ${projectName(item.projectId, item.environmentId)}`, selected)),
  ].join("");
}

function modelOptions(selected: string | undefined, inherit = false): string {
  return [
    option("", inherit ? "그래프 기본값 상속" : "Orca/에이전트 기본 모델", selected),
    ...targets.models.map((item) => option(item.id, item.label, selected)),
  ].join("");
}

function reasoningOptions(
  selected: string | undefined,
  modelId: string | undefined,
  { inherit = false, existingSession = false }: { inherit?: boolean; existingSession?: boolean } = {},
): string {
  const supported = existingSession ? [] : modelReasoningLevels(targets, modelId);
  const values: string[] = [...supported];
  if (selected && !values.includes(selected)) values.push(selected);
  const blankLabel = existingSession
    ? "기존 세션 현재 effort 유지"
    : inherit ? "그래프 기본값 상속" : "에이전트 기본값";
  return [
    option("", blankLabel, selected),
    ...values.map((value) => option(
      value,
      supported.includes(value as typeof supported[number]) ? value : `${value} · 적용 불가, 값을 비우십시오`,
      selected,
    )),
  ].join("");
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  return node.kind === "condition" ? { width: 160, height: 112 } : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

type NodeSide = "top" | "right" | "bottom" | "left";
type Point = { x: number; y: number };
type EdgeGeometry = {
  d: string;
  labelX: number;
  labelY: number;
  sourceSide: NodeSide;
  targetSide: NodeSide;
};

function pointForSide(node: GraphNode, side: NodeSide, offset = 0): Point {
  const size = nodeSize(node);
  if (side === "top") return { x: node.x + size.width / 2 + offset, y: node.y };
  if (side === "bottom") return { x: node.x + size.width / 2 + offset, y: node.y + size.height };
  if (side === "left") return { x: node.x, y: node.y + size.height / 2 + offset };
  return { x: node.x + size.width, y: node.y + size.height / 2 + offset };
}

function roundedOrthogonalPath(points: Point[], radius = 14): string {
  const clean = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  if (clean.length < 2) return "";
  let d = `M ${clean[0]!.x} ${clean[0]!.y}`;
  for (let index = 1; index < clean.length - 1; index += 1) {
    const previous = clean[index - 1]!;
    const corner = clean[index]!;
    const next = clean[index + 1]!;
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const bend = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x - ((corner.x - previous.x) / (incoming || 1)) * bend,
      y: corner.y - ((corner.y - previous.y) / (incoming || 1)) * bend,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / (outgoing || 1)) * bend,
      y: corner.y + ((next.y - corner.y) / (outgoing || 1)) * bend,
    };
    d += ` L ${Math.round(before.x * 10) / 10} ${Math.round(before.y * 10) / 10}`;
    d += ` Q ${corner.x} ${corner.y} ${Math.round(after.x * 10) / 10} ${Math.round(after.y * 10) / 10}`;
  }
  const end = clean.at(-1)!;
  return `${d} L ${end.x} ${end.y}`;
}

function edgeLabelPoint(points: Point[], edge: GraphEdge): Point {
  if (edge.branch && points.length > 1) {
    const start = points[0]!;
    const next = points[1]!;
    const length = Math.hypot(next.x - start.x, next.y - start.y) || 1;
    const distance = Math.min(42, Math.max(24, length * .45));
    const branch = edge.branch.trim().toLocaleLowerCase("en-US");
    const offset = branch === "y" ? -14 : branch === "n" ? 14 : -14;
    const horizontal = Math.abs(next.x - start.x) >= Math.abs(next.y - start.y);
    return {
      x: start.x + ((next.x - start.x) / length) * distance + (horizontal ? 0 : offset),
      y: start.y + ((next.y - start.y) / length) * distance + (horizontal ? offset : 0),
    };
  }
  const middle = Math.max(0, Math.floor((points.length - 1) / 2));
  const left = points[middle]!;
  const right = points[Math.min(points.length - 1, middle + 1)]!;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - 10 };
}

function sideToward(node: GraphNode, point: Point): NodeSide {
  const size = nodeSize(node);
  const center = { x: node.x + size.width / 2, y: node.y + size.height / 2 };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
}

function segmentHitsNode(left: Point, right: Point, node: GraphNode, clearance = 14): boolean {
  const size = nodeSize(node);
  const minX = node.x - clearance;
  const maxX = node.x + size.width + clearance;
  const minY = node.y - clearance;
  const maxY = node.y + size.height + clearance;
  if (left.x === right.x) {
    return left.x >= minX && left.x <= maxX
      && Math.max(Math.min(left.y, right.y), minY) <= Math.min(Math.max(left.y, right.y), maxY);
  }
  if (left.y === right.y) {
    return left.y >= minY && left.y <= maxY
      && Math.max(Math.min(left.x, right.x), minX) <= Math.min(Math.max(left.x, right.x), maxX);
  }
  return false;
}

function routeScore(points: Point[], graph: GraphDefinition, excluded: Set<string>): number {
  let score = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    score += Math.abs(right.x - left.x) + Math.abs(right.y - left.y);
    for (const node of graph.nodes) {
      if (!excluded.has(node.id) && segmentHitsNode(left, right, node)) score += 100_000;
    }
  }
  return score;
}

function bestOrthogonalRoute(
  start: Point,
  end: Point,
  orientation: "horizontal" | "vertical",
  graph: GraphDefinition,
  excluded: Set<string>,
): Point[] {
  const clearance = 56;
  const candidates = orientation === "horizontal"
    ? [
      (start.x + end.x) / 2,
      Math.max(start.x, end.x) + clearance,
      Math.min(start.x, end.x) - clearance,
      ...graph.nodes.filter((node) => !excluded.has(node.id)).flatMap((node) => [node.x - clearance, node.x + nodeSize(node).width + clearance]),
    ].map((x) => [start, { x, y: start.y }, { x, y: end.y }, end])
    : [
      (start.y + end.y) / 2,
      Math.max(start.y, end.y) + clearance,
      Math.min(start.y, end.y) - clearance,
      ...graph.nodes.filter((node) => !excluded.has(node.id)).flatMap((node) => [node.y - clearance, node.y + nodeSize(node).height + clearance]),
    ].map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]);
  return candidates.sort((left, right) => routeScore(left, graph, excluded) - routeScore(right, graph, excluded))[0] ?? [start, end];
}

function routeThroughWaypoints(start: Point, waypoints: Point[], end: Point): Point[] {
  const points: Point[] = [start];
  for (const waypoint of waypoints) {
    const previous = points.at(-1)!;
    if (previous.x !== waypoint.x && previous.y !== waypoint.y) {
      const horizontalFirst = Math.abs(waypoint.x - previous.x) >= Math.abs(waypoint.y - previous.y);
      points.push(horizontalFirst ? { x: waypoint.x, y: previous.y } : { x: previous.x, y: waypoint.y });
    }
    points.push(waypoint);
  }
  const previous = points.at(-1)!;
  if (previous.x !== end.x && previous.y !== end.y) {
    const horizontalFirst = Math.abs(end.x - previous.x) >= Math.abs(end.y - previous.y);
    points.push(horizontalFirst ? { x: end.x, y: previous.y } : { x: previous.x, y: end.y });
  }
  points.push(end);
  return points.filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
}

function edgePath(edge: GraphEdge, graph: GraphDefinition): EdgeGeometry | null {
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  if (!from || !to) return null;
  const fromSize = nodeSize(from);
  const toSize = nodeSize(to);
  const waypoints = graph.engineering?.editor?.edgeWaypoints?.[edge.id] ?? [];
  if (waypoints.length) {
    const sourceSide = sideToward(from, waypoints[0]!);
    const targetSide = sideToward(to, waypoints.at(-1)!);
    const points = routeThroughWaypoints(pointForSide(from, sourceSide), waypoints, pointForSide(to, targetSide));
    const label = edgeLabelPoint(points, edge);
    return { d: roundedOrthogonalPath(points), labelX: label.x, labelY: label.y, sourceSide, targetSide };
  }
  if (edge.kind === "loop") {
    if (from.id === to.id) {
      const start = pointForSide(from, "right", -16);
      const end = pointForSide(to, "right", 16);
      const outerX = start.x + 78;
      return {
        d: `M ${start.x} ${start.y} C ${outerX} ${start.y}, ${outerX} ${end.y}, ${end.x} ${end.y}`,
        labelX: outerX + 4,
        labelY: (start.y + end.y) / 2 - 10,
        sourceSide: "right",
        targetSide: "right",
      };
    }
    const start = pointForSide(from, "bottom");
    const end = pointForSide(to, "bottom");
    const corridorY = Math.max(start.y, end.y) + 84 + Math.abs(start.x - end.x) * .06;
    const points = [start, { x: start.x, y: corridorY }, { x: end.x, y: corridorY }, end];
    const label = edgeLabelPoint(points, edge);
    return {
      d: roundedOrthogonalPath(points, 18), labelX: label.x, labelY: corridorY + 18,
      sourceSide: "bottom", targetSide: "bottom",
    };
  }

  const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
  const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const overlaps = Math.abs(dx) < (fromSize.width + toSize.width) / 2 + 18
    && Math.abs(dy) < (fromSize.height + toSize.height) / 2 + 18;
  let sourceSide: NodeSide;
  let targetSide: NodeSide;
  let points: Point[];
  if (overlaps) {
    sourceSide = "right";
    targetSide = "right";
    const start = pointForSide(from, sourceSide);
    const end = pointForSide(to, targetSide);
    const corridorX = Math.max(start.x, end.x) + 68;
    points = [start, { x: corridorX, y: start.y }, { x: corridorX, y: end.y }, end];
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    sourceSide = dx >= 0 ? "right" : "left";
    targetSide = dx >= 0 ? "left" : "right";
    const start = pointForSide(from, sourceSide);
    const end = pointForSide(to, targetSide);
    points = bestOrthogonalRoute(start, end, "horizontal", graph, new Set([from.id, to.id]));
  } else {
    sourceSide = dy >= 0 ? "bottom" : "top";
    targetSide = dy >= 0 ? "top" : "bottom";
    const start = pointForSide(from, sourceSide);
    const end = pointForSide(to, targetSide);
    points = bestOrthogonalRoute(start, end, "vertical", graph, new Set([from.id, to.id]));
  }
  const label = edgeLabelPoint(points, edge);
  return {
    d: roundedOrthogonalPath(points), labelX: label.x, labelY: label.y,
    sourceSide, targetSide,
  };
}

function nodeIcon(node: GraphNode): string {
  if (node.kind === "condition") return "◇";
  if (node.kind === "graph_call") return "▦";
  return "✓";
}

function nodeSubtitle(node: GraphNode): string {
  if (node.kind === "condition") return node.conditionExpr || "조건을 입력하십시오";
  if (node.kind === "graph_call") {
    return store.graphs.find((graph) => graph.id === node.childGraphId)?.name ?? "호출할 그래프를 선택하십시오";
  }
  return node.task?.prompt || "Task 지시문을 입력하십시오";
}

function nodeVector(node: GraphNode): string {
  const size = nodeSize(node);
  if (node.kind === "condition") {
    return `<svg class="node-vector" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="node-shape" points="${size.width / 2},1 ${size.width - 1},${size.height / 2} ${size.width / 2},${size.height - 1} 1,${size.height / 2}"></polygon>
    </svg>`;
  }
  if (node.kind === "graph_call") {
    return `<svg class="node-vector" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
      <rect class="node-shape" x="1" y="1" width="${size.width - 2}" height="${size.height - 2}" rx="11"></rect>
      <rect class="node-shape-inner" x="6" y="6" width="${size.width - 12}" height="${size.height - 12}" rx="7"></rect>
      <path class="node-divider" d="M 7 32 H ${size.width - 7}"></path>
    </svg>`;
  }
  return `<svg class="node-vector" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="none" aria-hidden="true">
    <rect class="node-shape" x="1" y="1" width="${size.width - 2}" height="${size.height - 2}" rx="11"></rect>
    <path class="node-divider" d="M 1 32 H ${size.width - 1}"></path>
  </svg>`;
}

function graphWorldBounds(graph: GraphDefinition, padding = 0): { x: number; y: number; width: number; height: number } {
  if (!graph.nodes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...graph.nodes.map((node) => node.x)) - padding;
  const y = Math.min(...graph.nodes.map((node) => node.y)) - padding;
  const right = Math.max(...graph.nodes.map((node) => node.x + nodeSize(node).width)) + padding;
  const bottom = Math.max(...graph.nodes.map((node) => node.y + nodeSize(node).height)) + padding;
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function edgeTone(edge: GraphEdge, source: GraphNode | undefined): "default" | "y" | "n" | "custom" | "loop" | "complete" | "selected" {
  if (view.selectedEdgeId === edge.id) return "selected";
  const branch = edge.branch?.trim().toLocaleLowerCase("en-US");
  if (branch === "y") return "y";
  if (branch === "n") return "n";
  if (branch) return "custom";
  if (edge.kind === "loop") return "loop";
  if (source?.status === "done") return "complete";
  return "default";
}

function edgeDisplayLabel(edge: GraphEdge): string {
  const branch = edge.branch?.trim();
  if (branch?.toLocaleLowerCase("en-US") === "y") return "Y";
  if (branch?.toLocaleLowerCase("en-US") === "n") return "N";
  if (branch) return branch;
  if (edge.kind === "loop") return "LOOP";
  if (edge.kind === "blocks") return "BLOCK";
  if (edge.kind === "informs") return "INFO";
  return "";
}

function edgeLabelMarkup(edge: GraphEdge, geometry: EdgeGeometry, tone: ReturnType<typeof edgeTone>): string {
  const label = edgeDisplayLabel(edge);
  if (!label) return "";
  const width = Math.max(24, Math.min(96, label.length * 7 + 14));
  return `<g aria-hidden="true" class="edge-label-badge tone-${tone}" transform="translate(${Math.round(geometry.labelX * 10) / 10} ${Math.round(geometry.labelY * 10) / 10})">
    <rect x="${-width / 2}" y="-10" width="${width}" height="20" rx="10"></rect>
    <text text-anchor="middle" dy=".35em">${esc(label)}</text>
  </g>`;
}

function renderMinimap(graph: GraphDefinition): string {
  if (!view.showMinimap || !graph.nodes.length) return "";
  const bounds = graphWorldBounds(graph, 42);
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  const viewportWidth = (canvas?.clientWidth ?? 0) / view.zoom;
  const viewportHeight = (canvas?.clientHeight ?? 0) / view.zoom;
  const viewport = viewportWidth > 0 && viewportHeight > 0
    ? `<rect class="mini-viewport" x="${-view.panX / view.zoom}" y="${-view.panY / view.zoom}" width="${viewportWidth}" height="${viewportHeight}" rx="8"></rect>`
    : "";
  const nodes = graph.nodes.map((node) => {
    const size = nodeSize(node);
    if (node.kind === "condition") {
      return `<polygon class="mini-node ${node.kind} ${node.status}" points="${node.x + size.width / 2},${node.y} ${node.x + size.width},${node.y + size.height / 2} ${node.x + size.width / 2},${node.y + size.height} ${node.x},${node.y + size.height / 2}"></polygon>`;
    }
    return `<rect class="mini-node ${node.kind} ${node.status}" x="${node.x}" y="${node.y}" width="${size.width}" height="${size.height}" rx="8"></rect>`;
  }).join("");
  return `<button class="minimap" data-action="fit" title="미니맵 · 클릭하여 전체 맞춤" aria-label="미니맵에서 그래프 전체 맞춤">
    <svg viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${nodes}${viewport}</svg>
    <span>OVERVIEW</span>
  </button>`;
}

function semanticZoomLevel(): "detail" | "compact" | "overview" {
  return view.zoom >= .85 ? "detail" : view.zoom >= .5 ? "compact" : "overview";
}

function nodeDisplayTitle(node: GraphNode): string {
  const title = node.label || node.task?.title || node.id;
  if (node.kind === "condition" && (title === node.id || /^(GN|COND)-/u.test(title))) {
    const condition = node.conditionExpr?.trim();
    return condition ? condition.slice(0, 34) : "조건";
  }
  if (node.kind === "graph_call" && (title === node.id || /^(GN|CALL)-/u.test(title))) return "그래프 호출";
  return title;
}

function nodeGroupKey(graph: GraphDefinition, node: GraphNode, mode: GraphGroupMode, analysis: ReturnType<typeof analyzeGraph>): { id: string; label: string } | null {
  if (mode === "superstep") {
    const level = analysis.levels.get(node.id) ?? 0;
    return { id: `step-${level}`, label: `SUPERSTEP ${level + 1}` };
  }
  if (mode === "loop") return analysis.loopNodeIds.includes(node.id) ? { id: "loop", label: "FINITE LOOP" } : null;
  if (mode === "domain" || mode === "milestone") {
    const task = node.task ? store.tasks.find((item) => item.id === node.task?.id) : undefined;
    if (!task) return { id: "unscoped", label: "범위 미지정" };
    if (mode === "milestone") {
      const milestone = milestoneFor(task.milestoneId);
      if (milestone) return { id: milestone.id, label: milestone.name };
    }
    const domain = domainFor(task.domainId ?? milestoneFor(task.milestoneId)?.domainId);
    return domain ? { id: domain.id, label: domain.name } : { id: "unscoped", label: "범위 미지정" };
  }
  return null;
}

function renderGroupFrames(graph: GraphDefinition, analysis: ReturnType<typeof analyzeGraph>): string {
  const mode = graphGroupMode(graph);
  if (mode === "none") return "";
  const groups = new Map<string, { label: string; nodes: GraphNode[] }>();
  for (const node of graph.nodes) {
    const group = nodeGroupKey(graph, node, mode, analysis);
    if (!group) continue;
    const bucket = groups.get(group.id) ?? { label: group.label, nodes: [] };
    bucket.nodes.push(node);
    groups.set(group.id, bucket);
  }
  return [...groups.entries()].map(([id, group]) => {
    const x = Math.min(...group.nodes.map((node) => node.x)) - 30;
    const y = Math.min(...group.nodes.map((node) => node.y)) - 42;
    const right = Math.max(...group.nodes.map((node) => node.x + nodeSize(node).width)) + 30;
    const bottom = Math.max(...group.nodes.map((node) => node.y + nodeSize(node).height)) + 30;
    return `<section class="graph-group" data-group-id="${esc(id)}" style="left:${x}px;top:${y}px;width:${right - x}px;height:${bottom - y}px"><strong>${esc(group.label)}</strong><span>${group.nodes.length} nodes</span></section>`;
  }).join("");
}

function renderSelectionBox(): string {
  const box = view.selectionBox;
  if (!box) return "";
  const left = Math.min(box.startX, box.x);
  const top = Math.min(box.startY, box.y);
  return `<div class="selection-box" style="left:${left}px;top:${top}px;width:${Math.abs(box.x - box.startX)}px;height:${Math.abs(box.y - box.startY)}px"></div>`;
}

function renderQuickCreate(): string {
  const quick = view.quickCreate;
  if (!quick) return "";
  return `<div class="quick-create" style="left:${quick.x}px;top:${quick.y}px" role="menu" aria-label="연결할 노드 만들기">
    <strong>연결하여 만들기</strong>
    <button data-action="quick-create-node" data-kind="task">＋ Task</button>
    <button data-action="quick-create-node" data-kind="condition">＋ ◇ 조건</button>
    <button data-action="quick-create-node" data-kind="graph_call">＋ ▦ 그래프 호출</button>
    <button class="ghost" data-action="cancel-quick-create">취소</button>
  </div>`;
}

function renderProblems(graph: GraphDefinition): string {
  if (!view.problemsOpen) return "";
  const findings = [
    ...analyzeGraph(graph).findings.map((finding) => ({ ...finding, graphId: graph.id })),
    ...validateGraphLinks(store.graphs).filter((finding) => finding.graphId === graph.id).map((finding) => ({ ...finding, category: "structure" as const, chapter: "G→G" as const })),
  ];
  return `<aside class="problems-panel" aria-label="그래프 문제">
    <header><strong>Problems</strong><span>${findings.length}</span><button class="icon ghost" data-action="toggle-problems" aria-label="닫기">×</button></header>
    <div>${findings.length ? findings.map((finding) => `<button class="problem-row ${finding.severity}" data-action="focus-problem" data-id="${esc(finding.nodeId ?? "")}"><span>${finding.severity}</span><strong>${esc(finding.message)}</strong><small>${esc(finding.category)} · ${esc(finding.chapter)}</small></button>`).join("") : '<p class="help">구조 문제가 없습니다.</p>'}</div>
  </aside>`;
}

function renderCanvas(graph: GraphDefinition): string {
  if (view.layoutPreview?.graphId === graph.id) graph = view.layoutPreview.graph;
  const analysis = analyzeGraph(graph);
  const critical = new Set(analysis.criticalPathNodeIds);
  const loopNodes = new Set(analysis.loopNodeIds);
  const incomingFor = (id: string) => graph.edges.filter((edge) => edge.kind !== "loop" && edge.to === id);
  const ready = (node: GraphNode) => {
    if (node.status !== "pending") return false;
    const incoming = incomingFor(node.id);
    if (!incoming.length) return true;
    const open = incoming.filter((edge) => {
      const source = graph.nodes.find((item) => item.id === edge.from);
      if (!source || !["done", "skipped"].includes(source.status)) return false;
      return source.kind !== "condition" || !edge.branch || edge.branch.trim() === source.branchTaken?.trim();
    });
    return node.joinMode === "any" ? open.length > 0 : open.length === incoming.length;
  };
  const branchClosed = (node: GraphNode) => {
    const incoming = incomingFor(node.id);
    if (!incoming.length) return false;
    const closed = incoming.map((edge) => {
      const source = graph.nodes.find((item) => item.id === edge.from);
      return source?.kind === "condition" && source.status === "done" && Boolean(edge.branch) && edge.branch?.trim() !== source.branchTaken?.trim();
    });
    return node.joinMode === "any" ? closed.every(Boolean) : closed.some(Boolean);
  };
  const geometries = new Map(graph.edges.map((edge) => [edge.id, edgePath(edge, graph)]));
  const connectedPorts = new Map<string, Set<NodeSide>>();
  for (const edge of graph.edges) {
    const geometry = geometries.get(edge.id);
    if (!geometry) continue;
    const sourcePorts = connectedPorts.get(edge.from) ?? new Set<NodeSide>();
    const targetPorts = connectedPorts.get(edge.to) ?? new Set<NodeSide>();
    sourcePorts.add(geometry.sourceSide);
    targetPorts.add(geometry.targetSide);
    connectedPorts.set(edge.from, sourcePorts);
    connectedPorts.set(edge.to, targetPorts);
  }
  const edges = [...graph.edges]
    .sort((left, right) => Number(left.id === view.selectedEdgeId) - Number(right.id === view.selectedEdgeId))
    .map((edge) => {
      const path = geometries.get(edge.id);
      if (!path) return "";
      const source = graph.nodes.find((node) => node.id === edge.from);
      const target = graph.nodes.find((node) => node.id === edge.to);
      const branch = edge.branch?.trim().toLocaleLowerCase("en-US");
      const branchClass = branch === "y" ? "branch-y" : branch === "n" ? "branch-n" : branch ? "branch-custom" : "";
      const tone = edgeTone(edge, source);
      const label = edgeDisplayLabel(edge);
      const accessibleLabel = `${source?.label ?? edge.from}에서 ${target?.label ?? edge.to}로 가는 ${edge.kind} 연결${label ? `, 분기 ${label}` : ""}`;
      const waypoints = graph.engineering?.editor?.edgeWaypoints?.[edge.id] ?? [];
      return `<g data-edge-id="${esc(edge.id)}" data-action="select-edge" data-id="${esc(edge.id)}" role="button" tabindex="0" aria-label="${esc(accessibleLabel)}" aria-pressed="${view.selectedEdgeId === edge.id}">
        <path aria-hidden="true" class="edge-hit" d="${path.d}"></path>
        ${view.selectedEdgeId === edge.id ? `<path aria-hidden="true" class="edge-halo" d="${path.d}"></path>` : ""}
        <path aria-hidden="true" class="edge tone-${tone} ${edge.kind} ${branchClass} ${source?.status === "done" ? "completed" : ""} ${source?.status === "running" ? "active-flow" : ""} ${view.selectedEdgeId === edge.id ? "selected" : ""}" d="${path.d}" marker-end="url(#arrow-${tone})"></path>
        ${edgeLabelMarkup(edge, path, tone)}
        ${view.selectedEdgeId === edge.id ? waypoints.map((point, index) => `<circle class="edge-bend" data-edge-bend="${index}" data-edge-id="${esc(edge.id)}" cx="${point.x}" cy="${point.y}" r="7" role="button" tabindex="0" aria-label="연결 꺾임점 ${index + 1}"></circle>`).join("") : ""}
      </g>`;
    })
    .join("");

  const loopBounds = analysis.loopNodeIds.length ? (() => {
    const items = graph.nodes.filter((node) => loopNodes.has(node.id));
    const x = Math.min(...items.map((node) => node.x)) - 28;
    const y = Math.min(...items.map((node) => node.y)) - 28;
    const width = Math.max(...items.map((node) => node.x + nodeSize(node).width)) - x + 28;
    const height = Math.max(...items.map((node) => node.y + nodeSize(node).height)) - y + 28;
    return `<rect class="loop-bound" x="${x}" y="${y}" width="${width}" height="${height}" rx="22"></rect><text class="loop-caption" x="${x + 12}" y="${y + 18}">finite loop</text>`;
  })() : "";

  const nodes = graph.nodes
    .map((node) => {
      const routing = effectiveRouting(graph, node);
      const targetKind = routing.sessionId ? "세션" : routing.projectId ? "새 세션" : "실행 대상";
      const target = routing.sessionId ? sessionName(routing.sessionId) : routing.projectId ? projectName(routing.projectId) : "미지정";
      const model = modelName(routing.model);
      const usesAgentRoute = node.kind === "task" || (node.kind === "condition" && !node.branchTaken?.trim());
      const routeMissing = usesAgentRoute && !routing.sessionId && !routing.projectId;
      const nodeOverride = Object.values(routing.sources).some((source) => source === "node");
      const role = node.engineering?.role ?? (node.kind === "condition" ? "router" : "worker");
      const title = nodeDisplayTitle(node);
      const editorLabel = node.kind === "condition" ? "조건 편집" : node.kind === "graph_call" ? "그래프 호출 편집" : "Task 편집";
      const accessibleLabel = `${node.kind === "condition" ? "조건" : node.kind === "graph_call" ? "그래프 호출" : "작업"} 노드 ${title}, 상태 ${node.status}. 클릭하면 ${editorLabel}을 엽니다.`;
      const ports = connectedPorts.get(node.id) ?? new Set<NodeSide>();
      const connectingClass = view.connectingFrom === node.id ? "connecting-source" : view.connectingFrom ? "connecting-target" : "";
      const nodeFindings = analysis.findings.filter((finding) => finding.nodeId === node.id);
      const selected = view.selectedNodeIds.includes(node.id);
      const runResult = latestRun(graph)?.nodeResults?.find((result) => result.nodeId === node.id);
      const query = view.nodeQuery.trim().toLocaleLowerCase("ko-KR");
      const searchMatch = !query || `${node.id} ${title} ${nodeSubtitle(node)}`.toLocaleLowerCase("ko-KR").includes(query);
      return `<article class="node ${node.kind} status-${node.status} ${critical.has(node.id) ? "critical" : ""} ${loopNodes.has(node.id) ? "in-loop" : ""} ${ready(node) ? "ready" : ""} ${branchClosed(node) ? "branch-closed" : ""} ${selected ? "selected" : ""} ${routeMissing ? "route-missing" : ""} ${node.engineering?.layoutPinned ? "layout-pinned" : ""} ${query ? searchMatch ? "search-match" : "search-dim" : ""} ${connectingClass}" data-node-id="${esc(node.id)}" data-drag-node="${esc(node.id)}" data-action="select-node" data-id="${esc(node.id)}" role="button" tabindex="0" aria-label="${esc(accessibleLabel)}" aria-pressed="${selected}" style="left:${node.x}px;top:${node.y}px">
        ${nodeVector(node)}
        <span class="node-status-strip ${node.status}"></span>
        ${(["top", "right", "bottom", "left"] as NodeSide[]).map((side) => `<button class="connect-port port-${side} ${ports.has(side) ? "connected" : ""}" data-connect-port data-node-id="${esc(node.id)}" data-side="${side}" aria-label="${esc(title)} ${side} 연결점" title="드래그하여 연결"></button>`).join("")}
        <div class="node-head">
          <span class="node-kind">${nodeIcon(node)}</span>
          <span class="node-title">${esc(title)}</span>
          ${node.engineering?.layoutPinned ? '<span class="node-pin" title="자동 정렬 위치 고정">◆</span>' : ""}
          ${nodeFindings.length ? `<button class="node-problem ${nodeFindings.some((finding) => finding.severity === "error") ? "error" : "warning"}" data-action="focus-problem" data-id="${esc(node.id)}" title="${nodeFindings.length}개 문제">${nodeFindings.length}</button>` : ""}
          <button class="node-edit" data-action="edit-node" data-id="${esc(node.id)}" title="${editorLabel}" aria-label="${esc(title)} ${editorLabel}">편집</button>
          <span class="node-status ${node.status}" title="${esc(node.status)}"></span>
        </div>
        <div class="node-body">
          <div class="node-subtitle">${esc(nodeSubtitle(node))}</div>
          ${node.kind === "condition"
            ? `<div class="condition-route"><b>${node.branchTaken?.trim() ? `고정 분기 · ${esc(node.branchTaken)}` : `AI 자동 · ${esc(model)}`}</b>${node.branchTaken?.trim() ? "" : `<span>${esc(targetKind)} · ${esc(target)}</span>`}</div>`
            : `<div class="node-route-summary">
                <span class="route-line ${routeMissing ? "missing" : ""} ${nodeOverride ? "override" : ""}" title="${esc(target)}"><b>${targetKind}</b><span>${esc(target)}</span></span>
                <span class="route-line ${routing.sources.model === "node" ? "override" : ""}" title="${esc(routing.model ?? "gpt-5.6-sol")}"><b>AI</b><span>${esc(model)}${routing.reasoning ? ` · ${esc(routing.reasoning)}` : ""}</span></span>
              </div>
              <div class="node-chips node-policy-chips"><span class="chip role-${role}">${esc(role)}</span>${node.joinMode === "any" ? '<span class="chip">OR join</span>' : ""}${loopNodes.has(node.id) ? '<span class="chip loop-chip">↻ loop</span>' : ""}</div>`}
        </div>
        ${view.editorMode === "run" ? `<div class="node-run-meta"><span>attempt ${runResult?.attempt ?? 0}</span>${runResult?.durationMs ? `<span>${Math.round(runResult.durationMs / 100) / 10}s</span>` : ""}${runResult?.message ? `<strong title="${esc(runResult.message)}">${esc(runResult.message)}</strong>` : ""}</div>${role === "human_gate" ? `<div class="gate-actions"><button data-action="gate-decision" data-id="approved">승인</button><button class="danger" data-action="gate-decision" data-id="rejected">거절</button></div>` : ""}` : ""}
        ${selected && view.editorMode === "design" ? `<div class="node-quickbar"><button class="edit" data-action="edit-node" data-id="${esc(node.id)}">${editorLabel}</button><button data-action="duplicate-selection" title="복제">⧉</button><button data-action="connect-node" title="연결">→</button><button data-action="toggle-node-pin" title="위치 고정">${node.engineering?.layoutPinned ? "◇" : "◆"}</button><button class="danger" data-action="remove-node" title="삭제">×</button></div>` : ""}
      </article>`;
    })
    .join("");

  const progress = graphProgress(graph);
  const failed = graph.nodes.filter((node) => node.status === "failed").length;
  const linkFindings = validateGraphLinks(store.graphs).filter((finding) => finding.graphId === graph.id);
  const errors = analysis.findings.filter((finding) => finding.severity === "error").length + linkFindings.filter((finding) => finding.severity === "error").length;
  const warnings = analysis.findings.filter((finding) => finding.severity === "warning").length + linkFindings.filter((finding) => finding.severity === "warning").length;
  const minimap = renderMinimap(graph);
  const markerDefs = (["default", "y", "n", "custom", "loop", "complete", "selected"] as const)
    .map((tone) => `<marker id="arrow-${tone}" class="arrow-marker tone-${tone}" markerWidth="11" markerHeight="11" refX="9.5" refY="5.5" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 11 11"><path d="M 1 1 L 10 5.5 L 1 10 L 3.4 5.5 Z"></path></marker>`)
    .join("");
  const alignmentGuides = `<line class="alignment-guide" data-alignment-guide="x" x1="${view.alignmentGuides.x ?? 0}" y1="-2200" x2="${view.alignmentGuides.x ?? 0}" y2="4400" ${view.alignmentGuides.x === undefined ? "hidden" : ""}></line><line class="alignment-guide" data-alignment-guide="y" x1="-3200" y1="${view.alignmentGuides.y ?? 0}" x2="6400" y2="${view.alignmentGuides.y ?? 0}" ${view.alignmentGuides.y === undefined ? "hidden" : ""}></line>`;
  const minorWorldStep = view.zoom < .5 ? GRID * 4 : view.zoom < .8 ? GRID * 2 : GRID;
  const minorStep = minorWorldStep * view.zoom;
  const majorStep = GRID * 5 * view.zoom;
  const offset = (value: number, step: number) => ((value % step) + step) % step;
  const gridStyle = `--grid-minor:${minorStep}px;--grid-major:${majorStep}px;--grid-minor-x:${offset(view.panX, minorStep)}px;--grid-minor-y:${offset(view.panY, minorStep)}px;--grid-major-x:${offset(view.panX, majorStep)}px;--grid-major-y:${offset(view.panY, majorStep)}px`;
  const groupFrames = renderGroupFrames(graph, analysis);
  const previewing = view.layoutPreview?.graphId === graph.id;

  return `<div class="canvas-shell zoom-${semanticZoomLevel()} ${view.connectingFrom ? "connecting" : ""} mode-${view.editorMode}" data-canvas tabindex="0" style="${gridStyle}">
    <div class="world" style="transform:translate(${view.panX}px,${view.panY}px) scale(${view.zoom})">
      ${groupFrames}
      <svg class="edges" width="3200" height="2200" viewBox="0 0 3200 2200">
        <defs>${markerDefs}</defs>
        ${loopBounds}${edges}${alignmentGuides}
        <path class="connection-preview" data-connection-preview d="" hidden></path>
      </svg>
      ${nodes}
      ${renderQuickCreate()}
    </div>
    ${renderSelectionBox()}
    ${previewing ? '<div class="layout-preview-bar"><strong>자동 정렬 미리보기</strong><button class="primary" data-action="apply-layout">적용</button><button data-action="cancel-layout">취소</button></div>' : ""}
    <div class="canvas-guide" aria-hidden="true"><span>노드 클릭 · 편집</span><span>드래그 이동</span><span>포트 드래그 연결</span><span>Shift 영역 선택</span><span>휠 확대·축소</span><span>⌘Z 실행취소</span></div>
    <div class="progress-hud"><strong>${progress.percent}%</strong><span>${progress.complete}/${progress.total} 완료${failed ? ` · ${failed} 실패` : ""}</span><i><b style="width:${progress.percent}%"></b></i></div>
    <button class="validation-bar ${errors ? "bad" : warnings ? "warn" : "good"}" data-action="toggle-problems">${errors ? `오류 ${errors}` : "구조 통과"}${warnings ? ` · 경고 ${warnings}` : ""} · 임계 경로 ${analysis.criticalPathNodeIds.length} · 병렬도 ${analysis.maxParallelism}</button>
    ${renderProblems(graph)}
    ${minimap}
    <div class="canvas-hud">
      <button class="icon" data-action="zoom-out" title="축소 (−)" aria-label="축소">−</button>
      <button class="zoom-readout" data-action="zoom-reset" title="100%로 재설정">${Math.round(view.zoom * 100)}%</button>
      <button class="icon" data-action="zoom-in" title="확대 (+)" aria-label="확대">+</button>
      ${view.selectedNodeId ? '<button data-action="center-selection" title="선택 노드를 화면 중앙으로">선택 중앙</button>' : ""}
      <button data-action="fit" title="그래프 전체 맞춤 (0)">전체 맞춤</button>
      <button class="icon ${view.showMinimap ? "active" : ""}" data-action="toggle-minimap" title="미니맵" aria-label="미니맵 표시 전환">▧</button>
    </div>
  </div>`;
}

function graphInspector(graph: GraphDefinition): string {
  const warnings = validateGraph(graph);
  const analysis = analyzeGraph(graph);
  const linkFindings = validateGraphLinks(store.graphs).filter((finding) => finding.graphId === graph.id);
  const findingCount = warnings.length + linkFindings.length;
  const engineering = graph.engineering ?? {};
  const currentTab: InspectorTab = view.inspectorTab === "task" ? "basic" : view.inspectorTab;
  const active = (tab: InspectorTab) => currentTab === tab ? "active" : "";
  return `<div class="inspector-head"><strong>그래프 설정</strong><span class="badge">v${graph.version}</span><button class="icon ghost" data-action="toggle-inspector">×</button></div>
    <nav class="inspector-tabs graph-tabs" aria-label="그래프 설정 분류"><button class="${active("basic")}" data-action="inspector-tab" data-id="basic">기본</button><button class="${active("execution")}" data-action="inspector-tab" data-id="execution">실행</button><button class="${active("safety")}" data-action="inspector-tab" data-id="safety">안전·검증</button></nav>
    <div class="inspector-body tabbed">
      <section class="section inspector-panel ${active("basic")}" data-inspector-panel="basic">
        <div class="section-title">기본 정보</div>
        <label class="field"><span>이름</span><input data-scope="graph" data-field="name" value="${esc(graph.name)}"></label>
        <label class="field"><span>요약</span><textarea data-scope="graph" data-field="summary">${esc(graph.summary)}</textarea></label>
        <div class="field-row"><button data-action="copy-graph-id" data-id="${esc(graph.id)}">ID 복사</button><button data-action="toggle-archive">${graph.status === "archived" ? "보관 해제" : "그래프 보관"}</button></div>
        <div class="field-row">
          <label class="field"><span>상태</span><select data-scope="graph" data-field="status">
            ${["draft", "active", "running", "done", "archived"].map((value) => option(value, value, graph.status)).join("")}
          </select></label>
          <label class="field"><span>반복</span><select data-scope="graph" data-field="repeatMode">
            ${option("none", "반복 없음", graph.repeatMode)}${option("loop", "완료 시 반복", graph.repeatMode)}
          </select></label>
        </div>
        <div class="field-row">
          <label class="toggle-row"><span>📌 고정</span><input type="checkbox" data-scope="graph" data-field="pinned" ${graph.pinned ? "checked" : ""}></label>
          <label class="toggle-row"><span>🔁 루틴</span><input type="checkbox" data-scope="graph" data-field="routineEnabled" ${graph.routineEnabled ? "checked" : ""}></label>
        </div>
        ${graph.routineEnabled ? `<label class="field"><span>루틴 설명/주기</span><input data-scope="graph" data-field="routineSpec" value="${esc(graph.routineSpec ?? "")}" placeholder="매일 09:00"></label>` : ""}
        ${graph.repeatMode === "loop" ? `<label class="field"><span>최대 run 수</span><input type="number" min="1" data-scope="graph" data-field="maxRuns" value="${esc(graph.maxRuns ?? 10)}"></label>` : ""}
      </section>
      <section class="section engineering-section inspector-panel ${active("execution")}" data-inspector-panel="execution">
        <div class="section-title">Graph Engineering · Ch. 12–35</div>
        <div class="metric-grid"><span><b>${analysis.depth}</b> depth</span><span><b>${analysis.maxParallelism}</b> max parallel</span><span><b>${analysis.criticalPathNodeIds.length}</b> critical path</span><span><b>${analysis.loopNodeIds.length}</b> loop nodes</span></div>
        <label class="field"><span>Topology</span><select data-scope="graph-engineering" data-field="topology">${option("", "사용자 정의", engineering.topology)}${TOPOLOGY_TEMPLATES.map((item) => option(item.id, item.label, engineering.topology)).join("")}</select></label>
        <label class="field"><span>캔버스 그룹</span><select data-scope="graph-editor" data-field="groupBy">${option("none", "그룹 없음", graphGroupMode(graph))}${option("domain", "Domain 프레임", graphGroupMode(graph))}${option("milestone", "Milestone 프레임", graphGroupMode(graph))}${option("superstep", "Superstep 프레임", graphGroupMode(graph))}${option("loop", "Loop 프레임", graphGroupMode(graph))}</select></label>
        <label class="field"><span>설계 성숙도</span><select data-scope="graph-engineering" data-field="maturity">${option("", "분류 안 됨", engineering.maturity)}${option("standard", "standard", engineering.maturity)}${option("de_facto", "de facto", engineering.maturity)}${option("experimental", "experimental", engineering.maturity)}</select></label>
        <button data-action="open-templates">토폴로지 템플릿 열기</button>
        <label class="field"><span>검증 가능한 목표</span><textarea data-scope="graph-engineering" data-field="objective" placeholder="어떤 결과를 어떤 근거로 성공이라 판단할지">${esc(engineering.objective ?? "")}</textarea></label>
        <label class="field"><span>Competency questions · 한 줄에 하나</span><textarea data-scope="graph-engineering" data-field="competencyQuestions" placeholder="이 그래프가 답해야 하는 질문">${esc((engineering.competencyQuestions ?? []).join("\n"))}</textarea></label>
        <div class="field-row">
          <label class="field"><span>전체 토큰 예산</span><input type="number" min="0" data-scope="graph-engineering" data-field="globalBudgetTokens" value="${esc(engineering.globalBudgetTokens ?? "")}"></label>
          <label class="field"><span>검증 예약 토큰</span><input type="number" min="0" data-scope="graph-engineering" data-field="reservedVerificationTokens" value="${esc(engineering.reservedVerificationTokens ?? "")}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>최대 병렬도</span><input type="number" min="1" data-scope="graph-engineering" data-field="maxParallelism" value="${esc(engineering.maxParallelism ?? "")}"></label>
          <label class="field"><span>탐색 hop 제한</span><input type="number" min="1" data-scope="graph-engineering" data-field="traversalHopLimit" value="${esc(engineering.traversalHopLimit ?? "")}"></label>
        </div>
        <label class="field"><span>Checkpoint</span><select data-scope="graph-engineering" data-field="checkpointPolicy">${option("none", "없음", engineering.checkpointPolicy)}${option("superstep", "superstep마다", engineering.checkpointPolicy)}${option("node", "노드마다", engineering.checkpointPolicy)}</select></label>
        <label class="toggle-row"><span>결과 provenance/evidence 필수</span><input type="checkbox" data-scope="graph-engineering" data-field="requireProvenance" ${engineering.requireProvenance ? "checked" : ""}></label>
        <label class="toggle-row"><span>비가역 작업에 human gate 필수</span><input type="checkbox" data-scope="graph-engineering" data-field="humanGateForIrreversible" ${engineering.humanGateForIrreversible !== false ? "checked" : ""}></label>
      </section>
      <section class="section inspector-panel ${active("execution")}" data-inspector-panel="execution">
        <div class="section-title">Orca 실행 기본값</div>
        <p class="help">프로젝트·세션·모델은 독립적으로 지정할 수 있습니다. 노드에 값이 있으면 그 필드만 우선합니다.</p>
        <label class="field"><span>프로젝트</span><select data-scope="graph-routing" data-field="projectId">${projectOptions(graph.defaults.projectId)}</select></label>
        <label class="field"><span>세션</span><select data-scope="graph-routing" data-field="sessionId">${sessionOptions(graph.defaults.sessionId)}</select></label>
        <div class="field-row">
          <label class="field"><span>모델</span><select data-scope="graph-routing" data-field="model">${modelOptions(graph.defaults.model)}</select></label>
          <label class="field"><span>Reasoning</span><select data-scope="graph-routing" data-field="reasoning">
            ${reasoningOptions(graph.defaults.reasoning, graph.defaults.model, { existingSession: Boolean(graph.defaults.sessionId) })}
          </select></label>
        </div>
      </section>
      <section class="section inspector-panel ${active("safety")}" data-inspector-panel="safety">
        <div class="section-title">실행 가드</div>
        <div class="field-row">
          <label class="field"><span>claim lease(초)</span><input type="number" data-scope="guard" data-field="claimLeaseSeconds" value="${esc(graph.runGuards.claimLeaseSeconds ?? "")}"></label>
          <label class="field"><span>wall time(초)</span><input type="number" data-scope="guard" data-field="maxWallSeconds" value="${esc(graph.runGuards.maxWallSeconds ?? "")}"></label>
        </div>
        <label class="field"><span>정체 감지 run 수</span><input type="number" data-scope="guard" data-field="stagnationRuns" value="${esc(graph.runGuards.stagnationRuns ?? "")}"></label>
        <label class="field"><span>최대 토큰 예산</span><input type="number" data-scope="guard" data-field="maxBudgetTokens" value="${esc(graph.runGuards.maxBudgetTokens ?? "")}"></label>
      </section>
      <section class="section inspector-panel ${active("safety")}" data-inspector-panel="safety">
        <div class="section-title">구조 검증 · ${findingCount ? `${findingCount}건` : "통과"}</div>
        ${analysis.findings.length || linkFindings.length ? `<ul class="finding-list">${analysis.findings.map((finding) => `<li class="${finding.severity}"><b>Ch.${finding.chapter}</b> ${esc(finding.message)}</li>`).join("")}${linkFindings.map((finding) => `<li class="${finding.severity}"><b>G→G</b> ${esc(finding.message)}</li>`).join("")}</ul>` : '<p class="help">실행을 막는 구조 경고가 없습니다.</p>'}
        <button data-action="open-history">실행 이력 · ${graph.runs.length}</button>
      </section>
    </div>`;
}

function nodeInspector(graph: GraphDefinition, node: GraphNode): string {
  const engineering = node.engineering ?? {};
  const analysis = analyzeGraph(graph);
  const permissions = new Set(engineering.permissions ?? []);
  const active = (tab: InspectorTab) => view.inspectorTab === tab ? "active" : "";
  const findings = analysis.findings.filter((finding) => finding.nodeId === node.id);
  const editorLabel = node.kind === "condition" ? "조건 편집" : node.kind === "graph_call" ? "그래프 호출 편집" : "Task 편집";
  return `<div class="inspector-head"><span class="node-kind">${nodeIcon(node)}</span><strong>${editorLabel} · ${esc(nodeDisplayTitle(node))}</strong><button class="icon ghost" data-action="clear-selection">×</button></div>
    <nav class="inspector-tabs" aria-label="노드 설정 분류">
      ${([['basic', '기본'], ['task', node.kind === "task" ? 'Task' : node.kind === "condition" ? '조건' : '호출'], ['execution', '실행'], ['safety', '안전']] as Array<[InspectorTab, string]>).map(([id, label]) => `<button class="${active(id)}" data-action="inspector-tab" data-id="${id}">${label}</button>`).join("")}
    </nav>
    <div class="inspector-body tabbed">
      <section class="section inspector-panel ${active("basic")}" data-inspector-panel="basic">
        <div class="section-title">노드</div>
        <label class="field"><span>표시 이름</span><input data-scope="node" data-field="label" value="${esc(node.label)}"></label>
        <div class="field-row">
          <label class="field"><span>종류</span><select data-scope="node" data-field="kind">
            ${option("task", "Task", node.kind)}${option("condition", "Condition", node.kind)}${option("graph_call", "Graph call", node.kind)}
          </select></label>
          <label class="field"><span>상태</span><select data-scope="node" data-field="status" ${view.editorMode === "run" ? "disabled" : ""}>
            ${["pending", "running", "waiting", "done", "skipped", "failed"].map((value) => option(value, value, node.status)).join("")}
          </select></label>
        </div>
        <label class="field"><span>합류 방식</span><select data-scope="node" data-field="joinMode">${option("all", "모든 선행(AND)", node.joinMode)}${option("any", "하나라도(OR)", node.joinMode)}</select></label>
        <label class="toggle-row"><span>자동 정렬에서 위치 고정</span><input type="checkbox" data-scope="node-engineering" data-field="layoutPinned" ${engineering.layoutPinned ? "checked" : ""}></label>
        <div class="metric-grid"><span><b>${Math.round(node.x)}</b> x</span><span><b>${Math.round(node.y)}</b> y</span><span><b>${(analysis.levels.get(node.id) ?? 0) + 1}</b> step</span><span><b>${analysis.criticalPathNodeIds.includes(node.id) ? "yes" : "no"}</b> critical</span></div>
      </section>
      <div class="inspector-panel ${active("task")}" data-inspector-panel="task">${nodeKindFields(graph, node)}${nodeRoutingEditor(graph, node)}</div>
      <section class="section engineering-section inspector-panel ${active("execution")}" data-inspector-panel="execution">
        <div class="section-title">실행 계약 · Superstep ${(analysis.levels.get(node.id) ?? 0) + 1}${analysis.criticalPathNodeIds.includes(node.id) ? " · Critical path" : ""}${analysis.loopNodeIds.includes(node.id) ? " · Loop" : ""}</div>
        <div class="field-row">
          <label class="field"><span>역할</span><select data-scope="node-engineering" data-field="role">${["worker", "router", "verifier", "merge", "human_gate", "tool"].map((value) => option(value, value, engineering.role)).join("")}</select></label>
          <label class="field"><span>Context</span><select data-scope="node-engineering" data-field="contextMode">${["inherit", "fresh", "summary", "reference_only"].map((value) => option(value, value, engineering.contextMode)).join("")}</select></label>
        </div>
        <label class="field"><span>Reads · 쉼표/줄바꿈</span><textarea data-scope="node-engineering" data-field="reads">${esc((engineering.reads ?? []).join("\n"))}</textarea></label>
        <label class="field"><span>Writes · 쉼표/줄바꿈</span><textarea data-scope="node-engineering" data-field="writes">${esc((engineering.writes ?? []).join("\n"))}</textarea></label>
        <label class="field"><span>병렬 reducer</span><select data-scope="node-engineering" data-field="reducer">${option("", "없음", engineering.reducer)}${["append", "set_union", "latest_timestamp", "highest_confidence", "manual"].map((value) => option(value, value, engineering.reducer)).join("")}</select></label>
        <div class="field-row">
          <label class="field"><span>최대 시도</span><input type="number" min="1" data-scope="node-engineering" data-field="maxAttempts" value="${esc(engineering.maxAttempts ?? 1)}"></label>
          <label class="field"><span>Timeout(초)</span><input type="number" min="1" data-scope="node-engineering" data-field="timeoutSeconds" value="${esc(engineering.timeoutSeconds ?? "")}"></label>
        </div>
        <label class="field"><span>노드 토큰 예산</span><input type="number" min="0" data-scope="node-engineering" data-field="budgetTokens" value="${esc(engineering.budgetTokens ?? "")}"></label>
        <p class="help">Orca 프로젝트·세션·모델 선택은 ${node.kind === "task" ? "Task" : node.kind === "condition" ? "조건" : "호출"} 탭의 실행 대상에서 함께 관리합니다.</p>
      </section>
      <section class="section inspector-panel ${active("safety")}" data-inspector-panel="safety">
        <div class="section-title">권한·안전·검증</div>
        <label class="field"><span>Idempotency key</span><input data-scope="node-engineering" data-field="idempotencyKey" value="${esc(engineering.idempotencyKey ?? "")}" placeholder="중복 실행 방지 키"></label>
        <div class="field-row">
          <label class="field"><span>데이터 등급</span><select data-scope="node-engineering" data-field="dataClass">${["public", "internal", "sensitive", "restricted"].map((value) => option(value, value, engineering.dataClass)).join("")}</select></label>
          <label class="field"><span>기억 보존</span><select data-scope="node-engineering" data-field="retention">${["ephemeral", "run", "persistent"].map((value) => option(value, value, engineering.retention)).join("")}</select></label>
        </div>
        <div class="permission-grid">${["read", "write", "network", "exec"].map((permission) => `<label><input type="checkbox" data-scope="node-permission" data-field="${permission}" ${permissions.has(permission as "read") ? "checked" : ""}> ${permission}</label>`).join("")}</div>
        <label class="toggle-row"><span>외부 부작용 있음</span><input type="checkbox" data-scope="node-engineering" data-field="sideEffect" ${engineering.sideEffect ? "checked" : ""}></label>
        <label class="toggle-row"><span>비가역 작업</span><input type="checkbox" data-scope="node-engineering" data-field="irreversible" ${engineering.irreversible ? "checked" : ""}></label>
        <label class="toggle-row"><span>Evidence 필수</span><input type="checkbox" data-scope="node-engineering" data-field="evidenceRequired" ${engineering.evidenceRequired ? "checked" : ""}></label>
        ${engineering.role === "human_gate" ? `<label class="field"><span>승인 상태</span><select data-scope="node-engineering" data-field="approvalStatus">${["pending", "approved", "rejected"].map((value) => option(value, value, engineering.approvalStatus)).join("")}</select></label>` : ""}
        <label class="field"><span>실패/비가역 작업 보상 절차</span><textarea data-scope="node-engineering" data-field="compensation">${esc(engineering.compensation ?? "")}</textarea></label>
        ${findings.length ? `<ul class="finding-list">${findings.map((finding) => `<li class="${finding.severity}">${esc(finding.message)}</li>`).join("")}</ul>` : '<p class="help">이 노드에 연결된 검증 문제가 없습니다.</p>'}
      </section>
      <section class="section inspector-actions">
        <button data-action="connect-node" class="primary">${view.connectingFrom === node.id ? "연결 취소" : "이 노드에서 연결"}</button>
        <button data-action="duplicate-selection">선택 복제</button>
        <button data-action="remove-node" class="danger">노드 제거</button>
      </section>
    </div>`;
}

function nodeRoutingEditor(graph: GraphDefinition, node: GraphNode): string {
  const route = effectiveRouting(graph, node);
  const existingSession = Boolean(route.sessionId && node.engineering?.contextMode !== "fresh");
  const reasoningError = reasoningRouteError(route, targets, { existingSession });
  return `<section class="section node-routing-editor" aria-label="Orca 실행 대상">
    <div class="section-title">Orca 실행 대상</div>
    <p class="help">프로젝트·세션·모델을 필요한 항목만 지정할 수 있습니다. 비운 항목은 그래프 기본값을 상속하고, 이 노드의 선택값이 우선합니다.</p>
    <label class="field"><span>프로젝트</span><select data-scope="node-routing" data-field="projectId">${projectOptions(node.routing?.projectId, true)}</select></label>
    <label class="field"><span>세션</span><select data-scope="node-routing" data-field="sessionId">${sessionOptions(node.routing?.sessionId, true)}</select></label>
    <div class="field-row">
      <label class="field"><span>모델</span><select data-scope="node-routing" data-field="model">${modelOptions(node.routing?.model, true)}</select></label>
      <label class="field"><span>Reasoning</span><select data-scope="node-routing" data-field="reasoning">${reasoningOptions(node.routing?.reasoning, route.model, { inherit: true, existingSession })}</select></label>
    </div>
    ${reasoningError ? `<p class="warning-list">${esc(reasoningError.message)}</p>` : ""}
    <div class="effective" aria-label="실제 적용 실행 대상">
      <span class="chip ${route.sources.projectId === "node" ? "override" : ""}">P · ${esc(projectName(route.projectId))}</span>
      <span class="chip ${route.sources.sessionId === "node" ? "override" : ""}">S · ${esc(sessionName(route.sessionId))}</span>
      <span class="chip ${route.sources.model === "node" ? "override" : ""}">M · ${esc(route.model ?? "default")}</span>
      <span class="chip ${route.sources.reasoning === "node" ? "override" : ""}">E · ${esc(existingSession ? "current" : route.reasoning ?? "default")}</span>
    </div>
  </section>`;
}

function multiSelectionInspector(graph: GraphDefinition, nodes: GraphNode[]): string {
  const allPinned = nodes.every((node) => node.engineering?.layoutPinned);
  return `<div class="inspector-head"><span class="node-kind">${nodes.length}</span><strong>다중 선택</strong><button class="icon ghost" data-action="clear-selection">×</button></div>
    <div class="inspector-body">
      <section class="section"><div class="section-title">배치 배치</div>
        <div class="align-grid">
          ${["left", "center-x", "right", "top", "center-y", "bottom"].map((id) => `<button data-action="align-selection" data-id="${id}">${id}</button>`).join("")}
          <button data-action="distribute-selection" data-id="horizontal">가로 균등</button>
          <button data-action="distribute-selection" data-id="vertical">세로 균등</button>
        </div>
        <label class="toggle-row"><span>자동 정렬 위치 고정</span><input type="checkbox" data-action="batch-pin" ${allPinned ? "checked" : ""}></label>
      </section>
      <section class="section"><div class="section-title">실행 override 일괄 적용</div>
        <label class="field"><span>프로젝트</span><select data-scope="multi-node-routing" data-field="projectId">${projectOptions(undefined, true)}</select></label>
        <label class="field"><span>세션</span><select data-scope="multi-node-routing" data-field="sessionId">${sessionOptions(undefined, true)}</select></label>
        <label class="field"><span>모델</span><select data-scope="multi-node-routing" data-field="model">${modelOptions(undefined, true)}</select></label>
        <label class="field"><span>역할</span><select data-scope="multi-node-engineering" data-field="role">${option("", "변경하지 않음", undefined)}${["worker", "router", "verifier", "merge", "human_gate", "tool"].map((value) => option(value, value, undefined)).join("")}</select></label>
      </section>
      <section class="section inspector-actions"><button data-action="duplicate-selection">선택 복제</button><button class="danger" data-action="remove-node">선택 삭제</button></section>
    </div>`;
}

function nodeKindFields(graph: GraphDefinition, node: GraphNode): string {
  if (node.kind === "condition") {
    return `<section class="section"><div class="section-title">조건 판정</div>
      <label class="field"><span>조건</span><textarea data-scope="node" data-field="conditionExpr">${esc(node.conditionExpr ?? "")}</textarea></label>
      <label class="field"><span>현재 분기</span><input data-scope="node" data-field="branchTaken" value="${esc(node.branchTaken ?? "")}" placeholder="y / n / switch label"></label>
      <p class="help">분기 라벨과 일치하는 outgoing edge만 열립니다.</p>
    </section>`;
  }
  if (node.kind === "graph_call") {
    const child = store.graphs.find((item) => item.id === node.childGraphId);
    const defaults = child ? graphCallDefaults(graph, node, child) : {};
    return `<section class="section"><div class="section-title">하위 그래프</div>
      <label class="field"><span>호출할 그래프</span><select data-scope="node" data-field="childGraphId">
        ${option("", "선택하십시오", node.childGraphId)}
        ${store.graphs.filter((item) => item.id !== graph.id && item.status !== "archived").map((item) => option(item.id, item.name, node.childGraphId)).join("")}
      </select></label>
      <label class="field"><span>라우팅 결합</span><select data-scope="node" data-field="graphCallRoutingMode">
        ${option("child", "자식 그래프 설정만", node.graphCallRoutingMode)}
        ${option("inherit", "부모를 채우고 자식 우선", node.graphCallRoutingMode)}
        ${option("override", "호출 노드 값 우선", node.graphCallRoutingMode)}
      </select></label>
      <label class="field"><span>자식 실패 처리</span><select data-scope="node" data-field="graphCallFailureMode">
        ${option("fail_parent", "부모 그래프 실패", node.graphCallFailureMode)}
        ${option("continue", "실패 기록 후 계속", node.graphCallFailureMode)}
      </select></label>
      ${child ? `<div class="graph-call-preview"><strong>${esc(child.name)}</strong><span>${child.nodes.length} nodes · ${child.edges.length} edges · ${graphStatusLabel[child.status]}</span><span>기본 대상: ${esc(defaults.sessionId ? sessionName(defaults.sessionId) : defaults.projectId ? projectName(defaults.projectId) : "미지정")} · ${esc(defaults.model ?? "default model")}</span></div><button data-action="open-child-graph" data-id="${esc(child.id)}">하위 그래프 열기</button>` : ""}
    </section>`;
  }
  const taskReadOnly = dataSource.config.mode === "structured" && node.task?.version !== undefined;
  const managedTask = node.task ? store.tasks.find((item) => item.id === node.task?.id) : undefined;
  if (!managedTask) {
    return `<section class="section"><div class="section-title">Task 데이터</div>
      <label class="field"><span>Task ID</span><input data-scope="task" data-field="id" value="${esc(node.task?.id ?? "")}" ${taskReadOnly ? "readonly" : ""}></label>
      <label class="field"><span>제목</span><input data-scope="task" data-field="title" value="${esc(node.task?.title ?? "")}" ${taskReadOnly ? "readonly" : ""}></label>
      <label class="field"><span>지시문</span><textarea data-scope="task" data-field="prompt" ${taskReadOnly ? "readonly" : ""}>${esc(node.task?.prompt ?? "")}</textarea></label>
      <p class="help">이 노드는 관리 Task와 연결되어 있지 않아 기본 Task payload만 편집할 수 있습니다.</p>
    </section>`;
  }
  return `<section class="section node-task-editor" aria-label="노드 Task 내용">
    <div class="section-title">Task 내용 · ${esc(managedTask.id)}</div>
    <label class="field"><span>제목</span><input data-scope="local-task" data-field="title" value="${esc(managedTask.title)}"></label>
    ${scopeSelectors("local-task", managedTask)}
    ${promptPairEditor("task", managedTask)}
    <div class="field-row">
      <label class="field"><span>상태</span><select data-scope="local-task" data-field="status">${(Object.entries(taskStatusLabel) as Array<[LocalTaskStatus, string]>).map(([value, label]) => option(value, label, managedTask.status)).join("")}</select></label>
      <label class="field"><span>우선순위</span><select data-scope="local-task" data-field="priority">${(Object.entries(priorityLabel) as Array<[WorkPriority, string]>).map(([value, label]) => option(value, label, managedTask.priority)).join("")}</select></label>
    </div>
    <label class="field"><span>마감일</span><input type="date" data-scope="local-task" data-field="dueDate" value="${esc(managedTask.dueDate ?? "")}"></label>
    <label class="field"><span>태그 · 쉼표로 구분</span><input data-scope="local-task" data-field="tags" value="${esc(managedTask.tags.join(", "))}"></label>
    <button data-action="edit-managed-task" data-id="${esc(managedTask.id)}">Task 풀페이지 상세 열기</button>
    ${taskReadOnly ? '<p class="help">변경 내용은 연결된 구조화 데이터 원천에도 같은 Task version으로 양방향 반영됩니다.</p>' : ""}
  </section>`;
}

function edgeInspector(graph: GraphDefinition, edge: GraphEdge): string {
  const from = graph.nodes.find((node) => node.id === edge.from);
  const to = graph.nodes.find((node) => node.id === edge.to);
  const waypointCount = graph.engineering?.editor?.edgeWaypoints?.[edge.id]?.length ?? 0;
  return `<div class="inspector-head"><span class="node-kind">→</span><strong>연결 설정</strong><button class="icon ghost" data-action="clear-selection">×</button></div>
    <div class="inspector-body">
      <section class="section">
        <div class="section-title">${esc(from?.label ?? edge.from)} → ${esc(to?.label ?? edge.to)}</div>
        <div class="field-row">
          <label class="field"><span>시작 노드</span><select data-scope="edge-endpoint" data-field="from">${graph.nodes.map((node) => option(node.id, nodeDisplayTitle(node), edge.from)).join("")}</select></label>
          <label class="field"><span>도착 노드</span><select data-scope="edge-endpoint" data-field="to">${graph.nodes.map((node) => option(node.id, nodeDisplayTitle(node), edge.to)).join("")}</select></label>
        </div>
        <label class="field"><span>종류</span><select data-scope="edge" data-field="kind">
          ${(from?.kind === "condition" ? ["sequence", "blocks", "informs", "loop"] : ["sequence", "blocks", "informs"]).map((value) => option(value, value, edge.kind)).join("")}
        </select></label>
        ${from?.kind === "condition" ? `<label class="field"><span>분기 라벨</span><input data-scope="edge" data-field="branch" value="${esc(edge.branch ?? "")}" placeholder="y / n / switch label"></label>` : ""}
        ${from?.kind === "condition" ? '<div class="branch-quick"><button data-action="set-edge-branch" data-id="y">Y</button><button data-action="set-edge-branch" data-id="n">N</button><button data-action="set-edge-kind" data-id="loop">LOOP</button></div>' : ""}
        <p class="help">loop 엣지만 실행 순서의 순환으로 허용됩니다. 조건 노드의 outgoing edge에는 분기 라벨을 사용합니다.</p>
        <div class="field-row"><button data-action="add-edge-bend">꺾임점 추가</button><button data-action="clear-edge-bends" ${waypointCount ? "" : "disabled"}>꺾임점 초기화 · ${waypointCount}</button></div>
        <button data-action="remove-edge" class="danger">연결 제거</button>
      </section>
    </div>`;
}

function renderInspector(graph: GraphDefinition): string {
  const node = selectedNode(graph);
  const edge = selectedEdge(graph);
  const nodes = selectedNodes(graph);
  const kind = nodes.length > 1 ? "multi" : node ? "node" : edge ? "edge" : "graph";
  const label = kind === "graph" ? "그래프 설정" : kind === "edge" ? "연결 설정" : kind === "multi" ? "다중 노드 설정" : "노드 설정";
  return `<aside class="inspector ${view.inspectorOpen ? "" : "closed"}" data-inspector-kind="${kind}" aria-label="${label}">${nodes.length > 1 ? multiSelectionInspector(graph, nodes) : node ? nodeInspector(graph, node) : edge ? edgeInspector(graph, edge) : graphInspector(graph)}</aside>`;
}

function routingProblemMessages(label: string, route: RoutingTarget, existingSession = Boolean(route.sessionId)): string[] {
  const problems: string[] = [];
  const environmentId = routeEnvironmentId(route.environmentId);
  const environment = targets.environments?.find((item) => item.id === environmentId);
  if (targets.environments?.length && !environment) return [`${label}: 선택한 Orca 환경을 사용할 수 없습니다.`];
  if (environment && !environment.connected) {
    return [`${label}: Orca 환경 ${environment.name}에 연결할 수 없습니다.${environment.error ? ` ${environment.error}` : ""}`];
  }
  if (route.sessionId) {
    const session = targets.sessions.find((item) => item.id === route.sessionId && routeEnvironmentId(item.environmentId) === environmentId);
    if (!session?.connected || !session.writable) return [`${label}: 선택한 세션을 사용할 수 없습니다.`];
    const selectedModel = route.model ? targets.models.find((item) => item.id === route.model) : undefined;
    if (selectedModel && selectedModel.agent !== session.agentType) {
      problems.push(`${label}: 세션은 ${session.agentType}, 모델은 ${selectedModel.agent} 계열입니다.`);
    }
  } else {
    const project = targets.projects.find((item) => item.id === route.projectId && routeEnvironmentId(item.environmentId) === environmentId);
    if (!project?.worktreeId) problems.push(`${label}: 새 세션을 만들 프로젝트를 선택하십시오.`);
    const modelId = route.model || "gpt-5.6-sol";
    if (!targets.models.some((item) => item.id === modelId)) {
      problems.push(`${label}: 사용할 수 없는 AI 모델입니다 (${modelId}).`);
    }
  }
  const reasoningError = reasoningRouteError(route, targets, { existingSession });
  if (reasoningError) problems.push(`${label}: ${reasoningError.message}`);
  return problems;
}

function runRoutingProblems(graph: GraphDefinition): Array<{ nodeId: string; message: string }> {
  return graph.nodes
    .filter((item) => item.kind === "task" || (item.kind === "condition" && !item.branchTaken?.trim()))
    .flatMap((node) => {
      const route = effectiveRouting(graph, node);
      const existingSession = Boolean(route.sessionId && node.engineering?.contextMode !== "fresh");
      return routingProblemMessages(node.label || node.id, route, existingSession)
        .map((message) => ({ nodeId: node.id, message }));
    });
}

function runNodeRoutingRows(graph: GraphDefinition, modal: RunModalState): string {
  return graph.nodes.filter((node) => node.kind === "task" || (node.kind === "condition" && !node.branchTaken?.trim())).map((node) => {
    const route = effectiveRouting(graph, node);
    const existingSession = Boolean(route.sessionId && node.engineering?.contextMode !== "fresh");
    const target = route.sessionId
      ? `기존 세션 · ${sessionName(route.sessionId)}`
      : route.projectId ? `새 세션 · ${projectName(route.projectId)}` : "실행 대상 미지정";
    return `<article class="run-route-row ${!route.sessionId && !route.projectId ? "missing" : ""}" data-run-node-id="${esc(node.id)}">
      <header><strong>${esc(node.label || node.id)}</strong><span class="badge">${esc(target)}</span><span class="badge">AI · ${esc(modelName(route.model))}</span></header>
      <div class="run-node-route-grid">
        <label class="field"><span>프로젝트</span><select data-scope="run-node-routing" data-node-id="${esc(node.id)}" data-field="projectId">${projectOptions(modal.nodeRouting[node.id]?.projectId, true)}</select></label>
        <label class="field"><span>세션</span><select data-scope="run-node-routing" data-node-id="${esc(node.id)}" data-field="sessionId">${sessionOptions(modal.nodeRouting[node.id]?.sessionId, true)}</select></label>
        <label class="field"><span>AI 모델</span><select data-scope="run-node-routing" data-node-id="${esc(node.id)}" data-field="model">${modelOptions(modal.nodeRouting[node.id]?.model, true)}</select></label>
        <label class="field"><span>Reasoning</span><select data-scope="run-node-routing" data-node-id="${esc(node.id)}" data-field="reasoning">${reasoningOptions(modal.nodeRouting[node.id]?.reasoning, route.model, { inherit: true, existingSession })}</select></label>
      </div>
    </article>`;
  }).join("");
}

function runConditionRows(graph: GraphDefinition, modal: RunModalState): string {
  return graph.nodes.filter((node) => node.kind === "condition").map((node) => {
    const branches = [...new Set(graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.branch?.trim()).filter(Boolean))] as string[];
    const selected = modal.conditionBranches[node.id] ?? "";
    return `<article class="run-condition-row">
      <div><strong>${esc(node.label || node.id)}</strong><span>${esc(node.conditionExpr ?? "조건 정의 없음")}</span></div>
      <label class="field"><span>판정 방식</span><select data-scope="run-condition" data-node-id="${esc(node.id)}" data-field="branchTaken">
        ${option("", "실행 중 AI가 선행 결과로 자동 판정", selected)}
        ${branches.map((branch) => option(branch, `분기 고정 · ${branch}`, selected)).join("")}
      </select></label>
    </article>`;
  }).join("");
}

function renderModal(): string {
  if (!view.modal) return "";
  if (view.modal.kind === "bridge") {
    const context = view.modal.context;
    return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">로컬 브리지 연결</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p class="help">Orca pluginApi 1의 보안 경계 때문에 저장·프로젝트 검색·실행은 선택한 셸 터미널에서 투명하게 동작하는 브리지가 담당합니다.</p>
        ${view.modal.loading ? "<p>현재 워크트리 터미널을 읽는 중…</p>" : ""}
        ${view.modal.error ? `<p class="warning-list">${esc(view.modal.error)}</p>` : ""}
        ${context ? `<p class="help">${esc(context.displayName)} · ${esc(context.branch)}</p><div class="terminal-list">
          ${context.terminals.map((terminal) => `<button class="terminal-option ${store.bridgeTerminalId === terminal.id ? "primary" : ""}" data-action="choose-terminal" data-id="${esc(terminal.id)}"><span>▣</span><code>${esc(terminal.id)}</code></button>`).join("") || "<p>현재 워크트리에 열린 터미널이 없습니다.</p>"}
        </div>` : ""}
        <p class="help">셸 터미널을 고른 뒤 브리지 시작을 누르십시오. Codex/Claude TUI가 실행 중인 터미널은 선택하지 마십시오.</p>
      </div>
      <div class="modal-actions"><button data-action="close-modal">닫기</button><button class="primary" data-action="start-bridge" ${store.bridgeTerminalId ? "" : "disabled"}>브리지 시작</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "data-source") {
    const config = dataSource.config;
    const remote = config.mode === "structured" || config.mode === "unstructured";
    const folder = config.mode === "folder";
    const refreshable = config.mode !== "local";
    const unstructured = config.mode === "unstructured";
    const statusClass = dataSource.status === "ready" ? "good" : dataSource.status === "error" ? "bad" : "warn";
    return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">데이터 원천</strong><span class="status-pill ${statusClass}">${esc(dataSource.status)}</span><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p class="help">폴더 / Git 저장소는 지정 경로에 전체 데이터를 JSON으로 저장합니다. 구조화 Workspace는 Graph·Task·Todo와 CAS 버전을 원격 정본으로 사용하며, 구조 없음은 임의 JSON을 읽기 전용 후보로 투영합니다.</p>
        ${view.modal.error ? `<p class="warning-list">${esc(view.modal.error)}</p>` : ""}
        <div class="source-settings">
          <label class="field"><span>연결 방식</span><select data-source-field="mode">
            ${option("local", "로컬 JSON", config.mode)}
            ${option("folder", "폴더 / 로컬 Git 저장소", config.mode)}
            ${option("structured", "구조화 Workspace · contract v1", config.mode)}
            ${option("unstructured", "구조 없음 · JSON catalog", config.mode)}
          </select></label>
          <div class="source-mode-fields source-folder ${folder ? "" : "hidden"}">
            <label class="field"><span>폴더 또는 로컬 Git 저장소 경로</span><input data-source-field="folderPath" value="${esc(config.folderPath ?? "")}" placeholder="/absolute/path/to/my-graph-data"></label>
            <p class="help">이미 존재하는 절대 경로를 지정합니다. 데이터는 <code>.orca-graph-engineering/store.json</code>에 저장되며 Git commit·push는 자동으로 실행하지 않습니다.</p>
          </div>
          <div class="source-mode-fields source-remote ${remote ? "" : "hidden"}">
            <label class="field"><span>데이터 원천 URL</span><input data-source-field="url" value="${esc(config.url ?? "")}" placeholder="http://127.0.0.1:8000/"></label>
            <label class="field"><span>인증 토큰 환경변수</span><input data-source-field="authEnv" value="${esc(config.authEnv ?? "")}" placeholder="MY_SOURCE_TOKEN"></label>
            <p class="help">토큰 값은 설정이나 Graph 파일에 저장하지 않습니다. 브리지 terminal의 환경변수 이름만 기록합니다.</p>
          </div>
          <div class="source-mapping ${unstructured ? "" : "hidden"}">
            <label class="field"><span>레코드 배열 경로 · 선택</span><input data-source-field="recordsPath" value="${esc(config.recordsPath ?? "")}" placeholder="data.items"></label>
            <div class="field-row">
              <label class="field"><span>ID 필드</span><input data-source-field="idField" value="${esc(config.idField ?? "")}" placeholder="id"></label>
              <label class="field"><span>제목 필드</span><input data-source-field="titleField" value="${esc(config.titleField ?? "")}" placeholder="title"></label>
            </div>
            <label class="field"><span>본문 필드</span><input data-source-field="bodyField" value="${esc(config.bodyField ?? "")}" placeholder="content"></label>
          </div>
        </div>
        <section class="source-status">
          <div class="section-title">연결 상태 · ${esc(dataSource.source?.name ?? (refreshable ? "연결 전" : "local"))}</div>
          <p class="help">${esc(dataSource.message ?? "아직 동기화하지 않았습니다.")}${dataSource.refreshedAt ? ` · ${new Date(dataSource.refreshedAt).toLocaleString("ko-KR")}` : ""}</p>
        </section>
      </div>
      <div class="modal-actions"><button data-action="close-modal">닫기</button>${refreshable ? `<button data-action="refresh-source" aria-busy="${view.sourceRefreshing}" ${view.sourceRefreshing ? "disabled" : ""}>${view.sourceRefreshing ? "새로고침 중…" : "원천 새로고침"}</button>` : ""}<button class="primary" data-action="save-source">설정 저장·연결</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "task-run") {
    const modal = view.modal;
    const task = store.tasks.find((item) => item.id === modal.taskId);
    if (!task) {
      return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><strong id="modal-title">Task 실행</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
        <div class="modal-body"><p class="warning-list">선택한 Task를 찾을 수 없습니다.</p></div>
        <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
      </section></div>`;
    }
    const route = routingValue(modal.routing);
    const target = route.sessionId
      ? `기존 세션 · ${sessionName(route.sessionId, route.environmentId)}`
      : route.projectId ? `새 세션 · ${projectName(route.projectId, route.environmentId)}` : "실행 대상 미지정";
    const problems = [
      ...(task.status === "archived" ? [`${task.title}: 보관된 Task는 실행할 수 없습니다.`] : []),
      ...(!task.prompt.trim() ? [`${task.title}: 실행할 Prompt가 없습니다.`] : []),
      ...routingProblemMessages(task.title, route),
    ];
    const promptLabel = currentMetaRevision(task)?.status === "current" ? "현재 Meta Draft" : "현재 사람 Draft";
    return `<div class="modal-backdrop"><section class="modal wide run-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">Task 단건 실행</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <section class="task-run-summary"><span class="badge">${esc(task.status)}</span><strong>${esc(task.title)}</strong><small>${esc(task.id)}</small></section>
        <p class="help">그래프 run이나 노드 claim을 만들지 않고 이 Task의 ${promptLabel}만 독립 실행합니다. 원천 Task 상태는 자동으로 바뀌지 않습니다.</p>
        <section class="section run-defaults">
          <div class="section-title">실행 대상 ${modal.suggestedProjectId && route.projectId === modal.suggestedProjectId ? '<span class="badge">현재 브리지 작업공간 자동 선택</span>' : ""}</div>
          <div class="run-routing-grid">
            <label class="field"><span>Orca 환경</span><select data-scope="task-run-routing" data-field="environmentId">${environmentOptions(route.environmentId)}</select></label>
            <label class="field"><span>프로젝트</span><select data-scope="task-run-routing" data-field="projectId">${projectOptions(route.projectId, false, route.environmentId)}</select></label>
            <label class="field"><span>기존 세션</span><select data-scope="task-run-routing" data-field="sessionId">${sessionOptions(route.sessionId, false, route.environmentId)}</select></label>
            <label class="field"><span>AI 모델</span><select data-scope="task-run-routing" data-field="model">${modelOptions(route.model)}</select></label>
            <label class="field"><span>Reasoning</span><select data-scope="task-run-routing" data-field="reasoning">${reasoningOptions(route.reasoning, route.model, { existingSession: Boolean(route.sessionId) })}</select></label>
          </div>
          <div class="run-route-effective"><strong>${esc(environmentName(route.environmentId))} · ${esc(target)}</strong><span>AI · ${esc(modelName(route.model))}${route.reasoning ? ` · ${esc(route.reasoning)}` : ""}</span></div>
        </section>
        ${problems.length ? `<div class="run-configuration-errors"><strong>실행 설정 확인</strong><ul class="finding-list">${problems.map((message) => `<li class="error"><b>대상</b> ${esc(message)}</li>`).join("")}</ul></div>` : '<p class="status-pill good">Task와 실행 대상이 준비되었습니다.</p>'}
        <p class="warning-list">실행하면 Orca 터미널/에이전트 세션이 실제로 생성되거나 선택한 기존 세션에 Prompt가 전송됩니다.</p>
      </div>
      <div class="modal-actions"><button data-action="close-modal">취소</button><button class="primary" data-action="confirm-task-run" ${problems.length ? "disabled" : ""}>이 Task 실행</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "task-delete") {
    const modal = view.modal;
    const task = store.tasks.find((item) => item.id === modal.taskId);
    if (!task) {
      return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><strong id="modal-title">Task 삭제</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
        <div class="modal-body"><p class="warning-list">선택한 Task를 찾을 수 없습니다.</p></div>
        <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
      </section></div>`;
    }
    const links = taskGraphLinks(task.id);
    return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">Task 삭제</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p><strong>${esc(task.title)}</strong>을 삭제하시겠습니까?</p>
        <p class="help">데이터 보존을 위해 영구 삭제하지 않고 보관 상태로 전환합니다. ${links.length ? `Prompt 이력과 연결된 그래프 노드 ${links.length}개를 그대로 유지합니다.` : "Prompt 이력을 그대로 유지합니다."} 언제든 복원할 수 있습니다.</p>
      </div>
      <div class="modal-actions"><button data-action="close-modal">취소</button><button class="danger" data-action="confirm-task-delete">Task 삭제</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "run") {
    const sourceGraph = activeGraph();
    const graph = runDraftGraph(sourceGraph, view.modal);
    const analysis = analyzeGraph(graph, { targets });
    const draftGraphs = store.graphs.map((item) => item.id === graph.id ? graph : item);
    const linkFindings = validateGraphLinks(draftGraphs).filter((finding) => finding.graphId === graph.id);
    const hasLoop = graph.edges.some((edge) => edge.kind === "loop");
    // 원천이 원격 실행을 열어 두었으면 실행 상태는 여전히 원천이 소유하되 dispatch만
    // 여기가 한다. 열지 않았으면 예전 경계 그대로 — 저장 후 원천에서 시작한다.
    const remote = remoteExecution();
    const remoteUnsupported = remote
      ? graph.nodes.filter((node) => !remote.nodeKinds.includes(node.kind))
      : [];
    const runtimeBlockers = [
      ...(dataSource.config.mode === "structured" && !remote
        ? [{ severity: "error" as const, chapter: "source", message: "구조화 원천의 실행 상태는 원천이 소유합니다. 이 원천은 원격 실행을 열지 않았으므로 저장 후 원천 Workspace에서 실행을 시작하십시오." }]
        : []),
      // 절반쯤 가다 멈추는 실행보다 시작 전에 거절하는 편이 낫다.
      ...(view.modal.live
        ? remoteUnsupported.map((node) => ({ severity: "error" as const, chapter: "source", message: `${node.label || node.id}: 이 원천은 ${node.kind} 노드를 직접 실행합니다. 이 그래프는 원천 Workspace에서 실행하십시오.` }))
        : []),
      ...(view.modal.live ? [
        ...(hasLoop ? [{ severity: "error" as const, chapter: "runtime", message: "로컬 브리지는 loop 재진입을 아직 실행하지 않습니다. 실행 계획으로 경로와 guard를 검토하십시오." }] : []),
      ] : []),
    ];
    const errors = [...analysis.findings.filter((finding) => finding.severity === "error"), ...linkFindings.filter((finding) => finding.severity === "error").map((finding) => ({ ...finding, chapter: "G→G" })), ...runtimeBlockers];
    const warnings = [...analysis.findings.filter((finding) => finding.severity === "warning"), ...linkFindings.filter((finding) => finding.severity === "warning").map((finding) => ({ ...finding, chapter: "G→G" }))];
    const routingProblems = runRoutingProblems(graph);
    const blocked = errors.length > 0 || routingProblems.length > 0;
    const defaultRoute = graph.defaults.sessionId
      ? `기존 세션 · ${sessionName(graph.defaults.sessionId)}`
      : graph.defaults.projectId ? `새 세션 · ${projectName(graph.defaults.projectId)}` : "실행 대상 미지정";
    return `<div class="modal-backdrop"><section class="modal wide run-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">${view.modal.live ? "그래프 실행" : "실행 계획 생성"}</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p><b>${esc(graph.name)}</b> · 노드 ${graph.nodes.length}개</p>
        <section class="section run-defaults">
          <div class="section-title">기본 실행 대상 ${view.modal.suggestedProjectId && graph.defaults.projectId === view.modal.suggestedProjectId ? '<span class="badge">현재 브리지 작업공간 자동 선택</span>' : ""}</div>
          <p class="help">여기서 정한 값은 그래프에 저장됩니다. 노드별 설정이 있으면 그 값이 우선합니다.</p>
          <div class="run-routing-grid">
            <label class="field"><span>프로젝트</span><select data-scope="run-routing" data-field="projectId">${projectOptions(view.modal.defaults.projectId)}</select></label>
            <label class="field"><span>기존 세션</span><select data-scope="run-routing" data-field="sessionId">${sessionOptions(view.modal.defaults.sessionId)}</select></label>
            <label class="field"><span>AI 모델</span><select data-scope="run-routing" data-field="model">${modelOptions(view.modal.defaults.model)}</select></label>
            <label class="field"><span>Reasoning</span><select data-scope="run-routing" data-field="reasoning">${reasoningOptions(view.modal.defaults.reasoning, graph.defaults.model, { existingSession: Boolean(graph.defaults.sessionId) })}</select></label>
          </div>
          <div class="run-route-effective"><strong>${esc(defaultRoute)}</strong><span>AI · ${esc(modelName(graph.defaults.model))}${graph.defaults.reasoning ? ` · ${esc(graph.defaults.reasoning)}` : ""}</span></div>
        </section>
        <details class="run-node-settings" open>
          <summary>노드별 실행 대상 <span class="badge">${graph.nodes.filter((node) => node.kind === "task" || (node.kind === "condition" && !node.branchTaken?.trim())).length}</span></summary>
          <p class="help">상속을 유지하면 위 기본값을 사용합니다. Task와 자동 조건 판정마다 다른 세션이나 AI 모델을 지정할 수 있습니다.</p>
          <div class="run-node-route-list">${runNodeRoutingRows(graph, view.modal)}</div>
        </details>
        ${graph.nodes.some((node) => node.kind === "condition") ? `<details class="run-condition-settings" open>
          <summary>조건 판정 <span class="badge">자동</span></summary>
          <p class="help">기본값은 선행 노드의 결과 요약을 AI가 읽고 실제 분기를 선택하는 방식입니다. 테스트나 강제 실행이 필요할 때만 분기를 고정하십시오.</p>
          <div class="run-condition-list">${runConditionRows(graph, view.modal)}</div>
        </details>` : ""}
        <div class="run-metrics"><span>supersteps <b>${analysis.supersteps.length}</b></span><span>max parallel <b>${analysis.maxParallelism}</b></span><span>critical path <b>${analysis.criticalPathNodeIds.length}</b></span><span>loops <b>${analysis.loopNodeIds.length}</b></span></div>
        ${hasLoop && !view.modal.live ? '<p class="help">실행 계획은 loop back-edge와 guard를 검사합니다. 현재 로컬 브리지는 loop 재진입을 실제 실행하지 않습니다.</p>' : ""}
        ${routingProblems.length ? `<div class="run-configuration-errors"><strong>실행 설정 확인</strong><ul class="finding-list">${routingProblems.map((problem) => `<li class="error"><b>대상</b> ${esc(problem.message)}</li>`).join("")}</ul></div>` : '<p class="status-pill good">모든 실행 대상이 준비되었습니다.</p>'}
        ${errors.length || warnings.length ? `<div><strong>엔지니어링 검사</strong><ul class="finding-list">${[...errors, ...warnings].map((finding) => `<li class="${finding.severity}"><b>Ch.${finding.chapter}</b> ${esc(finding.message)}</li>`).join("")}</ul></div>` : '<p class="status-pill good">구조·안전 검증 통과</p>'}
        ${view.modal.live && remote ? '<p class="help">원격 실행: 노드 선점과 완료 기록은 원천 Workspace가 소유하고, 이 브리지는 Orca 세션 배정만 맡습니다. 같은 노드를 다른 실행자가 먼저 집으면 그 노드는 건너뜁니다.</p>' : ""}
        ${view.modal.live ? '<p class="warning-list">실행을 누르면 Orca 터미널/에이전트 세션이 실제로 생성되거나 기존 세션에 프롬프트가 전송됩니다.</p>' : ""}
      </div>
      <div class="modal-actions"><button data-action="close-modal">취소</button><button class="primary" data-action="confirm-run" ${blocked ? "disabled" : ""}>${view.modal.live ? "이 설정으로 실행" : "이 설정으로 계획 만들기"}</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "history") {
    const graph = activeGraph();
    return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">실행 이력 · ${esc(graph.name)}</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body run-history">
        ${graph.runs.length ? [...graph.runs].reverse().map((run) => `<article class="run-card">
          <header><strong>Run #${run.runNo}</strong><span class="badge run-${run.status}">${run.status}</span><span>${esc(run.trigger ?? "manual")}</span></header>
          <p>${esc(run.summary ?? run.terminationReason ?? "기록된 요약 없음")}</p>
          ${run.parentRunId ? `<p class="help">부모 ${esc(run.parentGraphId ?? "graph")} · ${esc(run.parentNodeId ?? "node")} · ${esc(run.parentRunId)}</p>` : ""}
          ${run.childRunIds?.length ? `<p class="help">자식 run · ${run.childRunIds.map(esc).join(" · ")}</p>` : ""}
          <small>${new Date(run.startedAt).toLocaleString("ko-KR")}${run.endedAt ? ` → ${new Date(run.endedAt).toLocaleString("ko-KR")}` : ""}</small>
          ${run.stats ? `<div class="run-metrics"><span>완료 <b>${run.stats.completed ?? 0}</b></span><span>실패 <b>${run.stats.failed ?? 0}</b></span><span>시도 <b>${run.stats.attempts ?? 0}</b></span><span>${Math.round((run.stats.durationMs ?? 0) / 1000)}s</span></div>` : ""}
          ${run.nodeResults?.length ? `<details><summary>노드 결과 ${run.nodeResults.length}</summary><ul class="finding-list">${run.nodeResults.map((result) => `<li class="${result.status === "failed" ? "error" : "info"}"><b>${esc(graph.nodes.find((node) => node.id === result.nodeId)?.label ?? result.nodeId)}</b> · ${result.status} · attempt ${result.attempt ?? 1}${result.durationMs ? ` · ${Math.round(result.durationMs / 1000)}s` : ""}${result.childGraphId ? `<br>child ${esc(result.childGraphId)}${result.childRunId ? ` · ${esc(result.childRunId)}` : ""}` : ""}${result.message ? `<br>${esc(result.message)}` : ""}</li>`).join("")}</ul></details>` : ""}
        </article>`).join("") : '<div class="graph-list-empty"><strong>실행 이력이 없습니다.</strong><span>실행 계획 또는 실제 실행 후 이곳에 기록됩니다.</span></div>'}
      </div>
      <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "templates") {
    return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">Graph topology 템플릿</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body"><p class="help">책의 agent topology를 실행 가능한 시작점으로 구성합니다. 현재 노드와 연결을 교체합니다.</p><div class="template-grid">
        ${TOPOLOGY_TEMPLATES.map((item) => `<button class="template-card" data-action="apply-template" data-id="${item.id}"><strong>${esc(item.label)}</strong><span>${esc(item.help)}</span></button>`).join("")}
      </div></div>
      <div class="modal-actions"><button data-action="close-modal">취소</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "batch-tasks") {
    return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">Task 노드 일괄 추가</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body"><p class="help">한 줄마다 독립적인 Task 노드 하나를 추가합니다.</p>
        ${view.modal.error ? `<p class="warning-list">${esc(view.modal.error)}</p>` : ""}<textarea class="batch-box" data-batch-editor placeholder="요구사항 분석\n구현\n독립 검증">${esc(view.modal.text)}</textarea></div>
      <div class="modal-actions"><button data-action="close-modal">취소</button><button class="primary" data-action="apply-batch-tasks">추가</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "shortcuts") {
    return `<div class="modal-backdrop"><section class="modal compact-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">그래프 편집기 단축키</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body shortcut-grid">
        <kbd>⌘/Ctrl + S</kbd><span>저장</span><kbd>⌘/Ctrl + Z</kbd><span>실행취소</span><kbd>⌘/Ctrl + Shift + Z</kbd><span>다시 실행</span>
        <kbd>⌘/Ctrl + C</kbd><span>선택 복사</span><kbd>⌘/Ctrl + V</kbd><span>붙여넣기</span><kbd>⌘/Ctrl + D</kbd><span>선택 복제</span>
        <kbd>Shift + 드래그</kbd><span>영역 선택</span><kbd>⌘/Ctrl + 클릭</kbd><span>다중 선택</span><kbd>Delete</kbd><span>선택 삭제</span>
        <kbd>방향키</kbd><span>선택 이동</span><kbd>Shift + 방향키</kbd><span>큰 폭 이동</span><kbd>0 / + / −</kbd><span>전체 맞춤 / 확대 / 축소</span>
        <kbd>⌘/Ctrl + K</kbd><span>노드 검색</span><kbd>Escape</kbd><span>연결·선택 취소</span>
      </div>
      <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
    </section></div>`;
  }
  return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><strong id="modal-title">그래프 JSON ${view.modal.mode === "export" ? "내보내기" : "가져오기"}</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
    <div class="modal-body">
      <p class="help">이 플러그인이 내보낸 Graph 또는 GraphStore JSON을 가져올 수 있습니다.</p>
      ${view.modal.error ? `<p class="warning-list">${esc(view.modal.error)}</p>` : ""}
      <textarea class="json-box" data-json-editor ${view.modal.mode === "export" ? "readonly" : ""}>${esc(view.modal.text)}</textarea>
    </div>
    <div class="modal-actions"><button data-action="close-modal">닫기</button>${view.modal.mode === "import" ? '<button class="primary" data-action="apply-import">가져오기</button>' : ""}</div>
  </section></div>`;
}

function renderGraphList(): string {
  const graphs = filteredGraphs();
  const statusOptions: Array<[ViewState["graphStatusFilter"], string]> = [
    ["all", "모든 상태"], ["draft", "초안"], ["active", "활성"], ["running", "실행 중"], ["done", "완료"], ["archived", "보관"],
  ];
  const runOptions: Array<[ViewState["graphRunFilter"], string]> = [
    ["all", "모든 실행 단계"], ["never", "미실행"], ["planned", "계획됨"], ["running", "실행 중"], ["stale", "확인 필요"], ["done", "성공"], ["failed", "실패"], ["cancelled", "취소"],
  ];
  const sortOptions: Array<[ViewState["graphSort"], string]> = [
    ["updated-desc", "최근 수정순"], ["updated-asc", "오래된 수정순"], ["name-asc", "이름 오름차순"], ["name-desc", "이름 내림차순"], ["status", "상태 우선순"],
  ];
  return `<section class="graph-list-view" aria-label="그래프 목록">
    <header class="graph-list-header">
      <div class="graph-list-title"><div><strong>그래프</strong><span>${graphs.length} / ${store.graphs.length}</span></div><span class="graph-list-actions"><button data-action="open-data-source">데이터 원천</button><button class="primary" data-action="new-graph">＋ 새 그래프</button></span></div>
      <div class="graph-facets">
        ${([['all', '전체'], ['pinned', '고정'], ['routine', '루틴'], ['running', '실행 중']] as const).map(([id, label]) => `<button class="${view.graphFacet === id ? "active" : ""}" data-action="graph-facet" data-id="${id}">${label}</button>`).join("")}
        <label><input type="checkbox" data-action="include-archived" ${view.includeArchived ? "checked" : ""}> 보관 포함</label>
      </div>
      <div class="graph-list-controls">
        <label class="graph-search"><span>⌕</span><input data-action="graph-search" value="${esc(view.graphQuery)}" placeholder="이름, 설명, ID 검색" aria-label="그래프 검색"></label>
        <select data-action="graph-status-filter" aria-label="그래프 상태 필터">${statusOptions.map(([value, label]) => option(value, label, view.graphStatusFilter)).join("")}</select>
        <select data-action="graph-run-filter" aria-label="실행 단계 필터">${runOptions.map(([value, label]) => option(value, label, view.graphRunFilter)).join("")}</select>
        <select data-action="graph-sort" aria-label="그래프 정렬">${sortOptions.map(([value, label]) => option(value, label, view.graphSort)).join("")}</select>
      </div>
    </header>
    <div class="graph-list-body">
      ${graphs.length ? graphs.map((item) => {
        const run = latestRun(item);
        const runStage = graphRunStage(item);
        const progress = graphProgress(item);
        return `<article class="graph-list-row ${item.id === store.activeGraphId ? "active" : ""}">
          <button class="graph-row-main" data-action="open-list-graph" data-id="${esc(item.id)}">
            <span class="graph-status-dot run-${runStage}" title="${esc(graphRunTitle(item))}"></span>
            <span class="graph-row-copy"><span class="graph-row-name">${item.pinned ? "📌 " : ""}${esc(item.name)}</span><span class="graph-row-summary">${esc(item.summary || "설명이 없습니다.")}</span></span>
            <span class="graph-row-badges"><span class="badge status-${item.status}" title="원천 그래프 상태: ${graphStatusLabel[item.status]}">${graphStatusBadgeLabel(item)}</span><span class="badge run-${runStage}" title="${esc(graphRunTitle(item))}">최근 실행 · ${graphRunLabel(item)}</span></span>
          </button>
          <div class="graph-row-meta">
            <span>${item.nodes.length} nodes · ${item.edges.length} edges</span>
            ${item.routineEnabled ? `<span>🔁 ${esc(item.routineSpec ?? "routine")}</span>` : ""}
            <span>${run ? `Run #${run.runNo}` : "Run 없음"}</span>
            ${runStage === "stale" ? `<button class="inline-warning-action" data-action="clear-stale-run" data-id="${esc(item.id)}">남은 실행 상태 정리</button>` : ""}
            <span>${new Date(item.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div class="graph-progress" title="완료 ${progress.complete}/${progress.total}"><span style="width:${progress.percent}%"></span></div>
        </article>`;
      }).join("") : `<div class="graph-list-empty"><strong>조건에 맞는 그래프가 없습니다.</strong><span>검색어나 필터를 바꾸어 보십시오.</span><button data-action="clear-list-filters">필터 초기화</button></div>`}
    </div>
  </section>`;
}

function renderSourceWorkCatalog(kind: "task" | "todo"): string {
  const items = dataSource.catalog.filter((item) => item.kind === kind && workItemMatches({ id: item.id, title: item.title }, item.body));
  return `<section class="work-manager" aria-label="${kind === "task" ? "Task" : "Todo"} 관리">
    <header class="work-manager-header">
      <div><strong>${kind === "task" ? "Task 관리" : "Todo 관리"}</strong><span>${items.length}개 · 구조화 원천</span></div>
      <p class="help">구조화 Workspace가 정본입니다. 이 화면에서는 항목을 읽고 현재 그래프에 노드로 연결할 수 있으며, 내용과 상태 변경은 원천 Workspace에서 수행합니다.</p>
      <label class="graph-search"><span>⌕</span><input data-action="work-search" value="${esc(view.workQuery)}" placeholder="제목, ID 검색" aria-label="${kind} 검색"></label>
    </header>
    <div class="work-manager-body source-only">
      <div class="work-list">
        ${items.length ? items.map((item) => `<article class="work-row">
          <span class="badge">${esc(item.kind)}</span>
          <span class="work-row-copy"><strong>${esc(item.title)}</strong><small>${esc(item.status ?? item.id)}</small><span>${esc(item.body ?? "설명 없음")}</span></span>
          <button data-action="add-source-item-from-manager" data-id="${esc(item.id)}">현재 그래프에 추가</button>
        </article>`).join("") : `<div class="graph-list-empty"><strong>표시할 ${kind === "task" ? "Task" : "Todo"}가 없습니다.</strong><span>데이터 원천을 새로고침하거나 검색어를 바꾸어 보십시오.</span></div>`}
      </div>
    </div>
  </section>`;
}

function scopeSelectors(scope: "local-task" | "local-todo", item: LocalTask | LocalTodo): string {
  const domains = store.domains.filter((domain) => domain.status !== "archived" || domain.id === item.domainId);
  const milestones = store.milestones.filter((milestone) =>
    (!item.domainId || milestone.domainId === item.domainId)
    && (milestone.status !== "archived" || milestone.id === item.milestoneId));
  return `<div class="field-row scope-fields">
    <label class="field"><span>Domain</span><select data-scope="${scope}" data-field="domainId">${option("", "독립 항목", item.domainId)}${domains.map((domain) => option(domain.id, domain.name, item.domainId)).join("")}</select></label>
    <label class="field"><span>Milestone</span><select data-scope="${scope}" data-field="milestoneId" ${item.domainId ? "" : "disabled"}>${option("", "Milestone 없음", item.milestoneId)}${milestones.map((milestone) => option(milestone.id, milestone.name, item.milestoneId)).join("")}</select></label>
  </div>`;
}

function promptPairEditor(kind: "task" | "todo", item: LocalTask | LocalTodo): string {
  const state = promptState(item);
  const currentDraft = currentDraftRevision(item);
  const stateLabel = ({ running: "생성 중", failed: "생성 실패", current: "최신", stale: "원문 변경됨", missing: "없음" } as const)[state];
  const disabled = !item.draft.trim() || state === "running" || !store.bridgeTerminalId;
  return `<section class="prompt-pair" aria-label="Draft와 Meta Draft">
    <header><div><strong>사람 Draft</strong><span class="badge good">r${currentDraft?.revision ?? 1}</span></div><span class="badge meta-${state}">Meta · ${stateLabel}</span></header>
    <label class="field"><span>사람이 작성한 원문</span><textarea class="prompt-editor" data-scope="local-${kind}" data-field="draft">${esc(item.draft)}</textarea></label>
    <div class="prompt-actions">
      <button class="primary" data-action="request-meta-prompt" data-kind="${kind}" data-id="${esc(item.id)}" ${disabled ? "disabled" : ""}>${state === "running" ? "Meta Prompt 생성 중…" : item.metaDraft ? "Meta Prompt 다시 만들기" : "Meta Prompt 만들기"}</button>
      <span class="help">새 Codex 세션 · 사람 Draft의 현재 revision 기준</span>
    </div>
    ${!store.bridgeTerminalId ? '<p class="help warning-inline">먼저 상단의 브리지에서 Orca 터미널을 연결하십시오.</p>' : ""}
    ${item.metaPromptRun?.status === "failed" ? `<p class="help warning-inline">${esc(item.metaPromptRun.error || "Meta Prompt 생성에 실패했습니다.")}</p>` : ""}
    <label class="field"><span>Meta Draft · ${state === "stale" ? "이전 사람 Draft 기준" : "실행에 사용할 정제본"}</span><textarea class="prompt-editor meta" readonly placeholder="Meta Prompt 버튼을 누르면 여기에 생성됩니다.">${esc(item.metaDraft ?? "")}</textarea></label>
    <details class="prompt-history"><summary>Prompt 이력 ${item.promptRevisions.length}</summary><ol>${[...item.promptRevisions].reverse().map((revision) => `<li><span class="badge">${revision.kind === "draft" ? "Draft" : "Meta"} r${revision.revision}</span><span>${revision.status === "current" ? "현재" : "이전"}</span><time>${new Date(revision.createdAt).toLocaleString("ko-KR")}</time></li>`).join("")}</ol></details>
  </section>`;
}

function taskInspector(task: LocalTask): string {
  const links = taskGraphLinks(task.id);
  return `<section class="work-detail-page" aria-label="Task 상세">
    <header class="work-detail-header">
      <button class="back-button" data-action="back-to-task-list" aria-label="Task 목록으로 돌아가기">← Task 목록</button>
      <div><span class="badge priority-${task.priority}">${priorityLabel[task.priority]}</span><strong>${esc(task.title)}</strong><small>${esc(task.id)}</small></div>
      <button class="primary task-run-button" data-action="open-task-run" data-id="${esc(task.id)}">▶ Task 실행</button>
    </header>
    <div class="work-detail-body">
      <label class="field"><span>제목</span><input data-scope="local-task" data-field="title" value="${esc(task.title)}"></label>
      ${scopeSelectors("local-task", task)}
      ${promptPairEditor("task", task)}
      <div class="field-row">
        <label class="field"><span>상태</span><select data-scope="local-task" data-field="status">${(Object.entries(taskStatusLabel) as Array<[LocalTaskStatus, string]>).map(([value, label]) => option(value, label, task.status)).join("")}</select></label>
        <label class="field"><span>우선순위</span><select data-scope="local-task" data-field="priority">${(Object.entries(priorityLabel) as Array<[WorkPriority, string]>).map(([value, label]) => option(value, label, task.priority)).join("")}</select></label>
      </div>
      <label class="field"><span>마감일</span><input type="date" data-scope="local-task" data-field="dueDate" value="${esc(task.dueDate ?? "")}"></label>
      <label class="field"><span>태그 · 쉼표로 구분</span><input data-scope="local-task" data-field="tags" value="${esc(task.tags.join(", "))}"></label>
      <section class="section"><div class="section-title">그래프 연결 · ${links.length}</div>
        ${links.length ? `<ul class="work-link-list">${links.map(({ graph, node }) => `<li><button data-action="open-task-node" data-graph-id="${esc(graph.id)}" data-id="${esc(node.id)}"><strong>${esc(graph.name)}</strong><span>${esc(node.label)}</span></button></li>`).join("")}</ul>` : '<p class="help">아직 어떤 그래프에도 연결되지 않았습니다.</p>'}
      </section>
      <button class="primary" data-action="add-local-task-node" data-id="${esc(task.id)}">현재 그래프에 노드 추가</button>
      ${task.status === "archived"
        ? `<button data-action="archive-local-task" data-id="${esc(task.id)}">Task 복원</button>`
        : `<button class="danger" data-action="open-task-delete" data-id="${esc(task.id)}">Task 삭제</button>`}
      <p class="help">Task 삭제는 영구 삭제 대신 보관 처리하며 기존 그래프 노드와 Prompt 이력을 유지합니다.</p>
    </div>
  </section>`;
}

function todoInspector(todo: LocalTodo): string {
  const linked = todo.taskId ? store.tasks.find((task) => task.id === todo.taskId) : undefined;
  return `<aside class="work-inspector">
    <header><div><span class="badge priority-${todo.priority}">${priorityLabel[todo.priority]}</span><strong>${esc(todo.title)}</strong></div><small>${esc(todo.id)}</small></header>
    <div class="work-inspector-body">
      <label class="field"><span>제목</span><input data-scope="local-todo" data-field="title" value="${esc(todo.title)}"></label>
      <div class="field-row"><label class="field"><span>그룹</span><input data-scope="local-todo" data-field="groupName" value="${esc(todo.groupName ?? "")}" placeholder="Todo 그룹"></label><label class="field"><span>하위그룹</span><input data-scope="local-todo" data-field="subgroupName" value="${esc(todo.subgroupName ?? "")}" placeholder="선택 사항"></label></div>
      ${scopeSelectors("local-todo", todo)}
      ${promptPairEditor("todo", todo)}
      <label class="field"><span>메모</span><textarea data-scope="local-todo" data-field="notes">${esc(todo.notes)}</textarea></label>
      <div class="field-row">
        <label class="field"><span>상태</span><select data-scope="local-todo" data-field="status">${(Object.entries(todoStatusLabel) as Array<[LocalTodoStatus, string]>).map(([value, label]) => option(value, label, todo.status)).join("")}</select></label>
        <label class="field"><span>우선순위</span><select data-scope="local-todo" data-field="priority">${(Object.entries(priorityLabel) as Array<[WorkPriority, string]>).map(([value, label]) => option(value, label, todo.priority)).join("")}</select></label>
      </div>
      <label class="field"><span>마감일</span><input type="date" data-scope="local-todo" data-field="dueDate" value="${esc(todo.dueDate ?? "")}"></label>
      <label class="field"><span>태그 · 쉼표로 구분</span><input data-scope="local-todo" data-field="tags" value="${esc(todo.tags.join(", "))}"></label>
      <label class="field"><span>연결 Task</span><select data-scope="local-todo" data-field="taskId">${option("", "연결 없음", todo.taskId)}${store.tasks.filter((task) => task.status !== "archived" || task.id === todo.taskId).map((task) => option(task.id, task.title, todo.taskId)).join("")}</select></label>
      ${linked ? `<button data-action="open-linked-task" data-id="${esc(linked.id)}">연결 Task 열기 · ${esc(linked.title)}</button>` : `<button class="primary" data-action="promote-todo" data-id="${esc(todo.id)}">Task로 전환</button>`}
      <button data-action="toggle-todo-done" data-id="${esc(todo.id)}">${todo.status === "done" ? "할 일로 되돌리기" : "Todo 완료"}</button>
      <button data-action="cancel-local-todo" data-id="${esc(todo.id)}">${todo.status === "cancelled" ? "할 일로 복원" : "Todo 취소"}</button>
      <p class="help">Todo를 Task로 전환하면 Domain·Milestone과 Draft 이력도 함께 복사됩니다.</p>
    </div>
  </aside>`;
}

function workScopeMatches(item: LocalTask | LocalTodo): boolean {
  const scope = itemScope(item);
  if (view.workDomainFilter === "standalone" && scope.domain) return false;
  if (view.workDomainFilter !== "all" && view.workDomainFilter !== "standalone" && scope.domain?.id !== view.workDomainFilter) return false;
  if (view.workMilestoneFilter === "none" && scope.milestone) return false;
  if (view.workMilestoneFilter !== "all" && view.workMilestoneFilter !== "none" && scope.milestone?.id !== view.workMilestoneFilter) return false;
  return true;
}

function selectedWorkGroup(isTask: boolean): WorkGroupMode {
  return isTask ? view.taskWorkGroup : view.todoWorkGroup;
}

function workGroupLabel(item: LocalTask | LocalTodo, isTask: boolean): string {
  const scope = itemScope(item);
  const groupMode = selectedWorkGroup(isTask);
  if (groupMode === "domain") return scope.domain?.name ?? "독립 항목";
  if (groupMode === "milestone") return scope.milestone ? `${scope.domain?.name ?? "Domain"} / ${scope.milestone.name}` : scope.domain ? `${scope.domain.name} / Milestone 없음` : "독립 항목";
  if (groupMode === "todo-group" && !isTask) {
    const todo = item as LocalTodo;
    return todo.groupName ? `${todo.groupName}${todo.subgroupName ? ` / ${todo.subgroupName}` : " / 하위그룹 없음"}` : "미분류 Todo";
  }
  if (groupMode === "status") return isTask ? taskStatusLabel[(item as LocalTask).status] : todoStatusLabel[(item as LocalTodo).status];
  if (groupMode === "priority") return `우선순위 · ${priorityLabel[item.priority]}`;
  return "전체";
}

function workGroupKey(label: string, isTask: boolean): string {
  return `${isTask ? "task" : "todo"}:${selectedWorkGroup(isTask)}:${label}`;
}

function renderWorkCards(items: Array<LocalTask | LocalTodo>, isTask: boolean, selectedId: string | undefined): string {
  const groups = new Map<string, Array<LocalTask | LocalTodo>>();
  for (const item of items) {
    const label = workGroupLabel(item, isTask);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups.entries()].map(([label, grouped]) => {
    const groupKey = workGroupKey(label, isTask);
    const collapsible = selectedWorkGroup(isTask) !== "none";
    const collapsed = collapsible && view.collapsedWorkGroups.has(groupKey);
    return `<section class="work-group ${collapsed ? "collapsed" : ""}" aria-label="그룹 ${esc(label)}">
    ${collapsible ? `<header><button class="work-group-toggle" data-action="toggle-work-group" data-id="${esc(groupKey)}" aria-expanded="${collapsed ? "false" : "true"}" aria-label="${esc(label)} 그룹 ${collapsed ? "펼치기" : "접기"}"><span class="work-group-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span><strong>${esc(label)}</strong><span>${grouped.length}</span></button></header>` : ""}
    ${collapsed ? "" : grouped.map((item) => {
      const selected = item.id === selectedId;
      const status = isTask ? taskStatusLabel[(item as LocalTask).status] : todoStatusLabel[(item as LocalTodo).status];
      const detail = item.draft;
      const link = isTask ? `${taskGraphLinks(item.id).length} graph nodes` : ((item as LocalTodo).taskId ? "Task 연결됨" : "Task 미연결");
      const metaState = promptState(item);
      return `<button class="work-card ${selected ? "selected" : ""}" data-action="${isTask ? "select-local-task" : "select-local-todo"}" data-id="${esc(item.id)}">
        <span class="work-card-head"><span class="work-status-dot status-${esc(item.status)}"></span><strong>${esc(item.title)}</strong><span class="badge priority-${item.priority}">${priorityLabel[item.priority]}</span></span>
        <span class="work-card-detail">${esc(detail || "Draft 없음")}</span>
        <span class="work-card-meta"><span>${esc(status)}</span><span>${esc(itemScope(item).label)}</span><span class="meta-label meta-${metaState}">Meta ${metaState === "current" ? "최신" : metaState === "running" ? "생성 중" : metaState === "stale" ? "이전본" : metaState === "failed" ? "실패" : "없음"}</span><span>${esc(link)}</span>${item.dueDate ? `<span>마감 ${esc(item.dueDate)}</span>` : ""}</span>
      </button>`;
    }).join("")}
  </section>`;
  }).join("");
}

function renderLocalWorkManager(kind: "task" | "todo"): string {
  const isTask = kind === "task";
  const workGroup = selectedWorkGroup(isTask);
  const activeTodoCount = store.todos.filter((todo) => todo.status === "open" || todo.status === "in_progress").length;
  const tasks = sortWorkItems(store.tasks.filter((task) =>
    (view.taskStatusFilter === "all" || task.status === view.taskStatusFilter)
    && workScopeMatches(task) && workItemMatches(task, `${task.draft} ${task.metaDraft ?? ""}`)));
  const todos = sortWorkItems(store.todos.filter((todo) =>
    (view.todoStatusFilter === "all"
      || (view.todoStatusFilter === "active" && (todo.status === "open" || todo.status === "in_progress"))
      || todo.status === view.todoStatusFilter)
    && workScopeMatches(todo) && workItemMatches(todo, `${todo.draft} ${todo.metaDraft ?? ""} ${todo.notes} ${todo.groupName ?? ""} ${todo.subgroupName ?? ""}`)));
  const detailTask = isTask && view.taskDetailOpen
    ? store.tasks.find((task) => task.id === view.selectedTaskId)
    : undefined;
  if (detailTask) return taskInspector(detailTask);
  if (isTask && view.taskDetailOpen) view.taskDetailOpen = false;
  const items: Array<LocalTask | LocalTodo> = isTask ? tasks : todos;
  const selectedTodo = todos.find((todo) => todo.id === view.selectedTodoId) ?? todos[0];
  if (!isTask && selectedTodo && view.selectedTodoId !== selectedTodo.id) view.selectedTodoId = selectedTodo.id;
  const statusSelect = isTask
    ? `<select data-action="task-status-filter" aria-label="Task 상태 필터">${option("all", "모든 상태", view.taskStatusFilter)}${(Object.entries(taskStatusLabel) as Array<[LocalTaskStatus, string]>).map(([value, label]) => option(value, label, view.taskStatusFilter)).join("")}</select>`
    : `<select data-action="todo-status-filter" aria-label="Todo 상태 필터">${option("active", "활성 Todo", view.todoStatusFilter)}${option("all", "모든 상태", view.todoStatusFilter)}${(Object.entries(todoStatusLabel) as Array<[LocalTodoStatus, string]>).map(([value, label]) => option(value, label, view.todoStatusFilter)).join("")}</select>`;
  const milestoneOptions = store.milestones.filter((item) => view.workDomainFilter === "all" || view.workDomainFilter === "standalone" || item.domainId === view.workDomainFilter);
  const countLabel = isTask
    ? `표시 ${items.length} · 전체 ${store.tasks.length}`
    : `표시 ${items.length} · 활성 ${activeTodoCount} · 전체 ${store.todos.length}`;
  const visibleGroupKeys = [...new Set(items.map((item) => workGroupKey(workGroupLabel(item, isTask), isTask)))];
  const allGroupsCollapsed = visibleGroupKeys.length > 0 && visibleGroupKeys.every((key) => view.collapsedWorkGroups.has(key));
  const allGroupsExpanded = visibleGroupKeys.every((key) => !view.collapsedWorkGroups.has(key));
  return `<section class="work-manager" aria-label="${isTask ? "Task" : "Todo"} 관리">
    <header class="work-manager-header">
      <div><strong>${isTask ? "Task 관리" : "Todo 관리"}</strong><span>${countLabel}</span><span class="badge">${dataSource.config.mode === "structured" ? "구조화 원천 · 양방향" : dataSource.config.mode === "folder" ? "폴더 원천 · 저장형" : dataSource.config.mode === "unstructured" ? "로컬 + 외부 후보" : "로컬"}</span></div>
      <span class="work-manager-actions"><button data-action="open-data-source">데이터 원천</button><button class="primary" data-action="${isTask ? "new-local-task" : "new-local-todo"}">＋ 새 ${isTask ? "Task" : "Todo"}</button></span>
      <div class="work-controls">
        <label class="graph-search"><span>⌕</span><input data-action="work-search" value="${esc(view.workQuery)}" placeholder="${isTask ? "제목, Draft, Meta, Domain, Milestone 검색" : "제목, Draft, Meta, 그룹, 하위그룹 검색"}" aria-label="${kind} 검색"></label>
        ${statusSelect}
        <select data-action="work-domain-filter" aria-label="Domain 필터">${option("all", "모든 Domain", view.workDomainFilter)}${option("standalone", "독립 항목", view.workDomainFilter)}${store.domains.map((domain) => option(domain.id, domain.name, view.workDomainFilter)).join("")}</select>
        <select data-action="work-milestone-filter" aria-label="Milestone 필터">${option("all", "모든 Milestone", view.workMilestoneFilter)}${option("none", "Milestone 없음", view.workMilestoneFilter)}${milestoneOptions.map((milestone) => option(milestone.id, milestone.name, view.workMilestoneFilter)).join("")}</select>
        <select data-action="work-group" aria-label="목록 그룹화">${option("none", "그룹화 없음", workGroup)}${!isTask ? option("todo-group", "그룹 · 하위그룹별", workGroup) : ""}${option("domain", "Domain별 그룹", workGroup)}${option("milestone", "Domain · Milestone별 그룹", workGroup)}${option("status", "상태별 그룹", workGroup)}${option("priority", "우선순위별 그룹", workGroup)}</select>
        <select data-action="work-sort" aria-label="업무 정렬">${option("updated-desc", "최근 수정순", view.workSort)}${option("due-asc", "마감 임박순", view.workSort)}${option("priority", "우선순위", view.workSort)}${option("title", "이름순", view.workSort)}</select>
      </div>
      ${workGroup !== "none" && items.length ? `<span class="work-group-bulk-actions" aria-label="그룹 일괄 제어"><button data-action="collapse-all-work-groups" ${allGroupsCollapsed ? "disabled" : ""}>모두 접기</button><button data-action="expand-all-work-groups" ${allGroupsExpanded ? "disabled" : ""}>모두 펼치기</button></span>` : ""}
    </header>
    <div class="work-manager-body ${isTask ? "task-list-only" : ""} ${items.length ? "" : "empty"}">
      <div class="work-list">
        ${items.length ? renderWorkCards(items, isTask, isTask ? undefined : selectedTodo?.id) : `<div class="graph-list-empty"><strong>조건에 맞는 ${isTask ? "Task" : "Todo"}가 없습니다.</strong><span>새 항목을 만들거나 검색·필터를 바꾸어 보십시오.</span><button class="primary" data-action="${isTask ? "new-local-task" : "new-local-todo"}">＋ 새 ${isTask ? "Task" : "Todo"}</button></div>`}
      </div>
      ${items.length && !isTask && selectedTodo ? todoInspector(selectedTodo) : ""}
    </div>
  </section>`;
}

function scopeCounts(kind: "domain" | "milestone", id: string): { milestones: number; tasks: number; todos: number; active: number } {
  const milestoneIds = new Set(kind === "domain"
    ? store.milestones.filter((item) => item.domainId === id).map((item) => item.id)
    : [id]);
  const tasks = store.tasks.filter((item) => kind === "domain" ? item.domainId === id || (item.milestoneId ? milestoneIds.has(item.milestoneId) : false) : item.milestoneId === id);
  const todos = store.todos.filter((item) => kind === "domain" ? item.domainId === id || (item.milestoneId ? milestoneIds.has(item.milestoneId) : false) : item.milestoneId === id);
  const activeTasks = tasks.filter((item) => item.status !== "done" && item.status !== "archived").length;
  const activeTodos = todos.filter((item) => item.status !== "done" && item.status !== "cancelled").length;
  return { milestones: milestoneIds.size, tasks: tasks.length, todos: todos.length, active: activeTasks + activeTodos };
}

function scopeInspector(kind: "domain" | "milestone", item: LocalDomain | LocalMilestone): string {
  const isDomain = kind === "domain";
  const domain = item as LocalDomain;
  const milestone = item as LocalMilestone;
  const counts = scopeCounts(kind, item.id);
  return `<aside class="work-inspector scope-inspector">
    <header><div><span class="badge">${isDomain ? "Domain" : "Milestone"}</span><strong>${esc(item.name)}</strong></div><small>${esc(item.id)} · v${item.version}</small></header>
    <div class="work-inspector-body">
      ${!isDomain ? `<label class="field"><span>Domain</span><select data-scope="local-milestone" data-field="domainId">${store.domains.filter((candidate) => candidate.status !== "archived" || candidate.id === milestone.domainId).map((candidate) => option(candidate.id, candidate.name, milestone.domainId)).join("")}</select></label>` : ""}
      <label class="field"><span>이름</span><input data-scope="local-${kind}" data-field="name" value="${esc(item.name)}"></label>
      <label class="field"><span>요약</span><textarea data-scope="local-${kind}" data-field="summary">${esc(item.summary)}</textarea></label>
      <label class="field"><span>목표</span><textarea data-scope="local-${kind}" data-field="objectives">${esc(item.objectives)}</textarea></label>
      <label class="field"><span>공통 메모</span><textarea data-scope="local-${kind}" data-field="commonNotes">${esc(item.commonNotes)}</textarea></label>
      <label class="field"><span>제약사항</span><textarea data-scope="local-${kind}" data-field="constraintNotes">${esc(item.constraintNotes)}</textarea></label>
      <label class="field"><span>${isDomain ? "Owners" : "Owner refs"} · 쉼표로 구분</span><input data-scope="local-${kind}" data-field="owners" value="${esc(item.owners.join(", "))}"></label>
      ${isDomain
        ? `<label class="field"><span>상태</span><select data-scope="local-domain" data-field="status" ${domain.status === "archived" ? "disabled" : ""}>${option(domain.status, domainStatusLabel[domain.status], domain.status)}</select></label>`
        : `<div class="field-row"><label class="field"><span>상태</span><select data-scope="local-milestone" data-field="status" ${milestone.status === "archived" ? "disabled" : ""}>${milestone.status === "archived" ? option("archived", "보관", milestone.status) : (["active", "blocked", "completed"] as MilestoneStatus[]).map((value) => option(value, milestoneStatusLabel[value], milestone.status)).join("")}</select></label><label class="field"><span>우선순위</span><select data-scope="local-milestone" data-field="priority">${(Object.entries(priorityLabel) as Array<[WorkPriority, string]>).map(([value, label]) => option(value, label, milestone.priority)).join("")}</select></label></div>
          <label class="field"><span>마감일</span><input type="date" data-scope="local-milestone" data-field="dueDate" value="${esc(milestone.dueDate ?? "")}"></label>
          <label class="field"><span>성공 기준 · 한 줄에 하나</span><textarea data-scope="local-milestone" data-field="successCriteria">${esc(milestone.successCriteria.join("\n"))}</textarea></label>`}
      <section class="scope-metrics"><span>Milestone <b>${counts.milestones}</b></span><span>Task <b>${counts.tasks}</b></span><span>Todo <b>${counts.todos}</b></span><span>활성 업무 <b>${counts.active}</b></span></section>
      <button data-action="archive-${kind}" data-id="${esc(item.id)}">${item.status === "archived" ? `${isDomain ? "Domain" : "Milestone"} 복원` : `${isDomain ? "Domain" : "Milestone"} 보관`}</button>
      <p class="help">활성 하위 업무가 남아 있으면 보관할 수 없습니다. 데이터는 hard delete하지 않습니다.</p>
    </div>
  </aside>`;
}

function renderScopeManager(kind: "domain" | "milestone"): string {
  const isDomain = kind === "domain";
  const query = view.scopeQuery.trim().toLocaleLowerCase("ko-KR");
  const source = isDomain ? store.domains : store.milestones;
  const items = source.filter((item) => {
    const milestone = item as LocalMilestone;
    const domainName = isDomain ? "" : domainFor(milestone.domainId)?.name ?? "";
    return !query || `${item.id} ${item.name} ${item.summary} ${item.objectives} ${domainName}`.toLocaleLowerCase("ko-KR").includes(query);
  }).sort((left, right) => left.status === "archived" && right.status !== "archived" ? 1 : right.updatedAt.localeCompare(left.updatedAt));
  const selectedId = isDomain ? view.selectedDomainId : view.selectedMilestoneId;
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  if (selected && isDomain) view.selectedDomainId = selected.id;
  if (selected && !isDomain) view.selectedMilestoneId = selected.id;
  return `<section class="work-manager scope-manager" aria-label="${isDomain ? "Domain" : "Milestone"} 관리">
    <header class="work-manager-header">
      <div><strong>${isDomain ? "Domain 관리" : "Milestone 관리"}</strong><span>${items.length} / ${source.length}</span><span class="badge">로컬</span></div>
      <span class="work-manager-actions"><button class="primary" data-action="new-${kind}">＋ 새 ${isDomain ? "Domain" : "Milestone"}</button></span>
      <label class="graph-search scope-search"><span>⌕</span><input data-action="scope-search" value="${esc(view.scopeQuery)}" placeholder="이름, 목표, 요약, ID 검색" aria-label="${kind} 검색"></label>
    </header>
    <div class="work-manager-body ${items.length ? "" : "empty"}">
      <div class="work-list">${items.length ? items.map((item) => {
        const milestone = item as LocalMilestone;
        const counts = scopeCounts(kind, item.id);
        return `<button class="work-card scope-card ${item.id === selected?.id ? "selected" : ""}" data-action="select-${kind}" data-id="${esc(item.id)}">
          <span class="work-card-head"><span class="work-status-dot status-${esc(item.status)}"></span><strong>${esc(item.name)}</strong><span class="badge">${esc(isDomain ? domainStatusLabel[(item as LocalDomain).status] : milestoneStatusLabel[milestone.status])}</span></span>
          <span class="work-card-detail">${esc(item.summary || item.objectives || "설명 없음")}</span>
          <span class="work-card-meta">${!isDomain ? `<span>${esc(domainFor(milestone.domainId)?.name ?? milestone.domainId)}</span>` : ""}<span>Task ${counts.tasks}</span><span>Todo ${counts.todos}</span><span>활성 ${counts.active}</span>${!isDomain && milestone.dueDate ? `<span>마감 ${esc(milestone.dueDate)}</span>` : ""}</span>
        </button>`;
      }).join("") : `<div class="graph-list-empty"><strong>${isDomain ? "Domain" : "Milestone"}이 없습니다.</strong><span>${!isDomain && !store.domains.length ? "먼저 Domain을 만드십시오." : "새 업무 범위를 만드십시오."}</span><button class="primary" data-action="new-${kind}" ${!isDomain && !store.domains.length ? "disabled" : ""}>＋ 새 ${isDomain ? "Domain" : "Milestone"}</button></div>`}</div>
      ${selected ? scopeInspector(kind, selected) : ""}
    </div>
  </section>`;
}

function renderSectionNav(): string {
  return `<nav class="section-tabs" aria-label="플러그인 메뉴">
    <button class="${view.mode === "list" ? "active" : ""}" data-action="set-view" data-id="list">그래프 목록</button>
    <button class="${view.mode === "canvas" ? "active" : ""}" data-action="set-view" data-id="canvas">그래프 보기</button>
    <button class="${view.mode === "domains" ? "active" : ""}" data-action="set-view" data-id="domains">Domain 관리</button>
    <button class="${view.mode === "milestones" ? "active" : ""}" data-action="set-view" data-id="milestones">Milestone 관리</button>
    <button class="${view.mode === "tasks" ? "active" : ""}" data-action="set-view" data-id="tasks">Task 관리</button>
    <button class="${view.mode === "todos" ? "active" : ""}" data-action="set-view" data-id="todos">Todo 관리</button>
  </nav>`;
}

function renderGraphTrail(): string {
  const trail = view.graphTrail
    .map((id) => store.graphs.find((graph) => graph.id === id))
    .filter((graph): graph is GraphDefinition => Boolean(graph));
  if (!trail.length) return "";
  return `<nav class="graph-trail" aria-label="상위 그래프 경로">${trail.map((graph, index) => `<button data-action="open-trail-graph" data-index="${index}" data-id="${esc(graph.id)}">${esc(graph.name)}</button><span>›</span>`).join("")}<strong>${esc(activeGraph().name)}</strong></nav>`;
}

function render(): void {
  const graph = activeGraph();
  const bridgeReady = Boolean(store.bridgeTerminalId);
  const runCount = graph.runs.length;
  const previousSemanticFocus = returnFocusFor(document.activeElement);
  const previousDialog = app.querySelector<HTMLElement>('[role="dialog"]');
  const previousFocusables = previousDialog ? focusableElements(previousDialog) : [];
  const previousFocusIndex = previousFocusables.indexOf(document.activeElement as HTMLElement);
  app.innerHTML = `<div class="app-shell mode-${view.editorMode} ${isWideMode ? "wide-mode" : ""}">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">⌘</span><span class="brand-copy"><strong>Graph Engineering</strong><small>Orca-native execution graph</small></span></div>
      <select class="graph-switcher" data-action="switch-graph" aria-label="그래프 선택">${graphOptions(graph.id)}</select>
      <button class="icon always" data-action="new-graph" title="새 그래프">＋</button>
      <button class="icon" data-action="clone-graph" title="그래프 복제">⧉</button>
      ${isWideMode ? '<span class="badge wide-badge">넓게 보기</span>' : '<button class="icon always" data-action="open-wide" title="Orca 중앙 탭에서 넓게 열기">⛶</button>'}
      <span class="topbar-spacer"></span>
      ${view.dirty ? '<span class="status-pill warn" role="status" aria-live="polite"><span class="dirty-dot"></span>저장 안 됨</span>' : '<span class="status-pill good" role="status" aria-live="polite">저장됨</span>'}
      <button class="ghost" data-action="open-data-source" title="그래프 데이터 원천 설정">데이터 원천</button>
      <button class="ghost" data-action="refresh-source" title="연결된 데이터 원천에서 최신 snapshot 가져오기" aria-label="데이터 원천 새로고침" aria-busy="${view.sourceRefreshing}" ${dataSource.config.mode === "local" || view.sourceRefreshing ? "disabled" : ""}>${view.sourceRefreshing ? "새로고침 중…" : "새로고침"}</button>
      <button class="ghost" data-action="connect-bridge">${bridgeReady ? "브리지 ✓" : "브리지"}</button>
      ${view.mode === "canvas" ? '<button class="primary always topbar-run" data-action="open-run" title="실행 대상과 조건 판정을 확인하고 그래프 실행">▶ 실행</button>' : ""}
      <button class="primary always" data-action="save">저장</button>
    </header>
    ${renderSectionNav()}
    ${view.mode === "list" ? `<div class="workspace list-mode">${renderGraphList()}</div>` : view.mode === "domains" ? `<div class="workspace list-mode">${renderScopeManager("domain")}</div>` : view.mode === "milestones" ? `<div class="workspace list-mode">${renderScopeManager("milestone")}</div>` : view.mode === "tasks" ? `<div class="workspace list-mode">${renderLocalWorkManager("task")}</div>` : view.mode === "todos" ? `<div class="workspace list-mode">${renderLocalWorkManager("todo")}</div>` : `<div class="workspace ${view.inspectorOpen ? "" : "inspector-closed"}">
      <section class="editor">
        ${renderGraphTrail()}
        <nav class="toolbar" aria-label="그래프 도구">
          <span class="toolbar-desktop">
            <span class="toolbar-group editor-mode-toggle"><button class="${view.editorMode === "design" ? "active" : ""}" data-action="editor-mode" data-id="design">설계</button><button class="${view.editorMode === "run" ? "active" : ""}" data-action="editor-mode" data-id="run">실행 보기</button></span>
            <span class="toolbar-group"><button data-action="add-task">＋ Task</button><button data-action="open-batch-tasks">＋ Task 묶음</button><button data-action="add-condition">＋ ◇ 조건</button><button data-action="add-graph-call">＋ ▦ 호출</button></span>
            <span class="toolbar-group"><button data-action="undo" ${view.historyUndo.length ? "" : "disabled"}>↶</button><button data-action="redo" ${view.historyRedo.length ? "" : "disabled"}>↷</button><button data-action="open-templates">Topology</button><button data-action="auto-layout">자동 정렬 미리보기 ${view.layoutDirection}</button><button data-action="toggle-layout">${view.layoutDirection === "LR" ? "가로 → 세로" : "세로 → 가로"}</button></span>
            <span class="toolbar-group"><label class="node-search"><span>⌕</span><input data-action="node-search" value="${esc(view.nodeQuery)}" placeholder="노드 검색 ⌘K" aria-label="노드 검색"></label><select data-action="group-mode" aria-label="캔버스 그룹">${option("none", "그룹 없음", graphGroupMode(graph))}${option("domain", "Domain", graphGroupMode(graph))}${option("milestone", "Milestone", graphGroupMode(graph))}${option("superstep", "Superstep", graphGroupMode(graph))}${option("loop", "Loop", graphGroupMode(graph))}</select></span>
            <span class="toolbar-group"><button data-action="refresh-targets">Orca 대상 갱신</button><button data-action="open-plan">실행 계획</button></span>
            <span class="toolbar-group"><button data-action="show-analysis">그래프 설정</button><button data-action="toggle-problems">Problems</button><button data-action="open-history">실행 이력</button><button data-action="export-json">JSON</button><button data-action="import-json">가져오기</button><button data-action="open-shortcuts">?</button><span class="badge">run ${runCount}</span></span>
          </span>
          <span class="toolbar-compact">
            <button data-action="add-task">＋ Task</button>
            <button data-action="add-condition">＋ 조건</button>
            <button data-action="undo" ${view.historyUndo.length ? "" : "disabled"}>↶</button>
            <details class="toolbar-more">
              <summary title="그래프 도구 더 보기">•••</summary>
              <div class="toolbar-popover">
                <button data-action="add-graph-call">＋ 그래프 호출</button>
                <button data-action="open-batch-tasks">＋ Task 묶음</button>
                <button data-action="open-templates">Topology 템플릿</button>
                <button data-action="auto-layout">자동 정렬 미리보기 ${view.layoutDirection}</button>
                <button data-action="toggle-layout">레이아웃 방향 전환</button>
                <button data-action="editor-mode" data-id="${view.editorMode === "design" ? "run" : "design"}">${view.editorMode === "design" ? "실행 보기" : "설계 모드"}</button>
                <button data-action="redo" ${view.historyRedo.length ? "" : "disabled"}>다시 실행</button>
                <button data-action="reset-run">실행 상태 리셋</button>
                <button data-action="show-analysis">그래프 설정</button>
                <button data-action="toggle-problems">Problems</button>
                <button data-action="open-data-source">데이터 원천</button>
                <button data-action="refresh-targets">Orca 대상 갱신</button>
                <button data-action="open-plan">실행 계획</button>
                <button data-action="open-history">실행 이력</button>
                <button data-action="export-json">JSON 내보내기</button>
                <button data-action="import-json">JSON 가져오기</button>
                <button data-action="open-shortcuts">단축키</button>
                <span class="badge">run ${runCount}</span>
              </div>
            </details>
          </span>
        </nav>
        ${renderCanvas(graph)}
      </section>
      ${renderInspector(graph)}
    </div>`}
    <footer class="bottom-status" role="status" aria-live="polite" aria-atomic="true">
      <span class="status-pill ${bridgeReady ? "good" : "warn"}">${bridgeReady ? "● bridge" : "○ bridge off"}</span>
      <span class="message">${esc(store.lastBridgeMessage ?? "그래프를 편집한 뒤 저장하십시오.")}</span>
      <span class="status-pill ${dataSource.status === "ready" ? "good" : dataSource.status === "error" ? "bad" : "warn"}">${esc(dataSource.config.mode)} · ${esc(dataSource.status)}</span>
      <span>${targets.environments?.length ?? 1} environments · ${targets.projects.length} projects · ${targets.sessions.length} sessions · built ${new Date(bootstrap.builtAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
    </footer>
    ${renderModal()}
    ${isWideMode && view.mode !== "canvas" ? '<button class="graph-fab" data-action="set-view" data-id="canvas" title="그래프 보기"><strong>그래프 보기</strong></button>' : ""}
    ${view.toast ? `<div class="toast" role="status" aria-live="polite" aria-atomic="true">${esc(view.toast)}</div>` : ""}
  </div>`;
  const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) {
    const focusables = focusableElements(dialog);
    if (modalInitialFocusPending) {
      (dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ?? focusables[0] ?? dialog).focus();
      modalInitialFocusPending = false;
    } else if (previousFocusIndex >= 0) {
      focusables[Math.min(previousFocusIndex, Math.max(0, focusables.length - 1))]?.focus();
    }
  } else {
    focusReturnTarget(previousSemanticFocus);
  }
}

function addNode(kind: GraphNode["kind"], position?: Point): GraphNode {
  const graph = activeGraph();
  const before = graphSnapshot(graph);
  const count = graph.nodes.length;
  const id = newId(kind === "task" ? "NODE" : kind === "condition" ? "COND" : "CALL");
  const base: GraphNode = {
    id,
    kind,
    label: kind === "task" ? "새 Task" : kind === "condition" ? "새 조건" : "그래프 호출",
    x: position ? Math.round(position.x / GRID) * GRID : 48 + (count % 3) * 270,
    y: position ? Math.round(position.y / GRID) * GRID : 48 + Math.floor(count / 3) * 140,
    status: "pending",
    joinMode: "all",
  };
  if (kind === "task") {
    base.task = { id: newId("task"), title: "새 Task", prompt: "수행할 작업을 입력하십시오." };
    base.routing = {};
    if (localWorkMutable()) upsertLocalTask(base.task);
  } else if (kind === "condition") {
    base.conditionExpr = "판정할 조건을 입력하십시오.";
  } else {
    base.graphCallRoutingMode = "child";
    base.graphCallFailureMode = "fail_parent";
  }
  graph.nodes.push(base);
  touch(graph);
  setNodeSelection([id], id);
  view.inspectorOpen = true;
  view.inspectorTab = kind === "task" ? "task" : "basic";
  recordGraphHistory(before, `${kind} 노드 추가`, graph);
  render();
  return base;
}

function addBatchTasks(labels: string[]): void {
  const graph = activeGraph();
  const before = graphSnapshot(graph);
  const start = graph.nodes.length;
  labels.forEach((label, index) => {
    const id = newId("NODE");
    const node: GraphNode = {
      id,
      kind: "task",
      label,
      x: 48 + ((start + index) % 3) * 270,
      y: 48 + Math.floor((start + index) / 3) * 140,
      status: "pending",
      joinMode: "all",
      task: { id: newId("task"), title: label, prompt: `${label} 작업을 수행하고 결과와 근거를 기록하세요.` },
      routing: {},
      engineering: { role: "worker", contextMode: "inherit", maxAttempts: 1, permissions: ["read"] },
    };
    graph.nodes.push(node);
    if (localWorkMutable()) upsertLocalTask(node.task);
  });
  touch(graph);
  const ids = graph.nodes.slice(-labels.length).map((node) => node.id);
  setNodeSelection(ids, ids.at(-1));
  view.inspectorOpen = true;
  recordGraphHistory(before, `Task 노드 ${labels.length}개 추가`, graph);
}

function addLocalTaskNode(task: LocalTask): void {
  const graph = activeGraph();
  if (graph.nodes.some((node) => node.task?.id === task.id)) {
    toast("이 Task는 현재 그래프에 이미 연결되어 있습니다.");
    return;
  }
  const before = graphSnapshot(graph);
  const id = newId("NODE");
  const node: GraphNode = {
    id,
    kind: "task",
    label: task.title,
    x: 48 + (graph.nodes.length % 3) * 270,
    y: 48 + Math.floor(graph.nodes.length / 3) * 140,
    status: "pending",
    joinMode: "all",
    task: {
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      ...(task.version !== undefined ? { version: task.version } : {}),
      ...(task.metadata ? { metadata: structuredClone(task.metadata) } : {}),
    },
    routing: {},
    engineering: { role: "worker", contextMode: "inherit", maxAttempts: 1, permissions: ["read"] },
  };
  graph.nodes.push(node);
  if (localWorkMutable()) upsertLocalTask(node.task);
  touch(graph);
  setNodeSelection([id], id);
  recordGraphHistory(before, "연결 Task 노드 추가", graph);
  toast(`${task.title} Task를 현재 그래프에 추가했습니다.`);
}

function connectTo(targetId: string): void {
  const graph = activeGraph();
  const from = view.connectingFrom;
  if (!from || from === targetId) {
    view.connectingFrom = null;
    render();
    return;
  }
  if (graph.edges.some((edge) => edge.from === from && edge.to === targetId && edge.kind !== "loop")) {
    toast("이미 연결된 노드입니다.");
    return;
  }
  if (wouldCreateCycle(graph, from, targetId)) {
    view.connectingFrom = null;
    toast("이 연결은 비-loop 순환을 만듭니다. Loop 연결은 연결 설정에서 명시적으로 지정하십시오.");
    return;
  }
  const before = graphSnapshot(graph);
  const source = graph.nodes.find((node) => node.id === from);
  const usedBranches = new Set(graph.edges.filter((edge) => edge.from === from).map((edge) => edge.branch?.trim().toLocaleLowerCase("en-US")));
  const branch = source?.kind === "condition" ? (!usedBranches.has("y") ? "y" : !usedBranches.has("n") ? "n" : `branch-${usedBranches.size + 1}`) : undefined;
  const edge: GraphEdge = {
    id: newId("EDGE"),
    from,
    to: targetId,
    kind: "sequence",
    ...(branch ? { branch } : {}),
  };
  graph.edges.push(edge);
  view.connectingFrom = null;
  view.connectionPointer = null;
  view.selectedNodeIds = [];
  view.selectedNodeId = null;
  view.selectedEdgeId = edge.id;
  touch(graph);
  recordGraphHistory(before, "노드 연결", graph);
  render();
}

function removeSelectedNode(): void {
  const graph = activeGraph();
  const ids = new Set(view.selectedNodeIds.length ? view.selectedNodeIds : view.selectedNodeId ? [view.selectedNodeId] : []);
  if (!ids.size) return;
  const before = graphSnapshot(graph);
  graph.nodes = graph.nodes.filter((node) => !ids.has(node.id));
  graph.edges = graph.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to));
  const waypoints = editorPolicy(graph).edgeWaypoints;
  if (waypoints) for (const edgeId of Object.keys(waypoints)) if (!graph.edges.some((edge) => edge.id === edgeId)) delete waypoints[edgeId];
  clearGraphSelection();
  touch(graph);
  recordGraphHistory(before, `노드 ${ids.size}개 삭제`, graph);
  render();
}

function removeSelectedEdge(): void {
  const graph = activeGraph();
  if (!view.selectedEdgeId) return;
  const before = graphSnapshot(graph);
  graph.edges = graph.edges.filter((edge) => edge.id !== view.selectedEdgeId);
  if (graph.engineering?.editor?.edgeWaypoints) delete graph.engineering.editor.edgeWaypoints[view.selectedEdgeId];
  view.selectedEdgeId = null;
  touch(graph);
  recordGraphHistory(before, "연결 삭제", graph);
  render();
}

type GraphClipboard = { nodes: GraphNode[]; edges: GraphEdge[] };
let graphClipboard: GraphClipboard | null = null;

function copySelection(): boolean {
  const graph = activeGraph();
  const nodes = selectedNodes(graph);
  if (!nodes.length) return false;
  const ids = new Set(nodes.map((node) => node.id));
  graphClipboard = {
    nodes: structuredClone(nodes),
    edges: structuredClone(graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to))),
  };
  void navigator.clipboard.writeText(JSON.stringify({ type: "orca-graph-selection", ...graphClipboard })).catch(() => undefined);
  toast(`${nodes.length}개 노드를 복사했습니다.`);
  return true;
}

function pasteSelection(): void {
  if (!graphClipboard?.nodes.length) { toast("먼저 노드를 복사하십시오."); return; }
  const graph = activeGraph();
  const before = graphSnapshot(graph);
  const idMap = new Map<string, string>();
  const nodes = graphClipboard.nodes.map((node) => {
    const id = newId(node.kind === "task" ? "NODE" : node.kind === "condition" ? "COND" : "CALL");
    idMap.set(node.id, id);
    const clone = structuredClone(node);
    clone.id = id;
    clone.label = `${nodeDisplayTitle(node)} 복사본`;
    clone.x += GRID * 3;
    clone.y += GRID * 3;
    clone.status = "pending";
    delete clone.branchTaken;
    if (clone.task) {
      const taskId = newId("task");
      clone.task.id = taskId;
      delete clone.task.version;
      if (localWorkMutable()) upsertLocalTask(clone.task);
    }
    return clone;
  });
  const edges = graphClipboard.edges.flatMap((edge) => {
    const from = idMap.get(edge.from);
    const to = idMap.get(edge.to);
    return from && to ? [{ ...structuredClone(edge), id: newId("EDGE"), from, to }] : [];
  });
  graph.nodes.push(...nodes);
  graph.edges.push(...edges);
  touch(graph);
  setNodeSelection(nodes.map((node) => node.id));
  recordGraphHistory(before, `노드 ${nodes.length}개 붙여넣기`, graph);
  render();
}

function duplicateSelection(): void {
  if (copySelection()) pasteSelection();
}

function alignSelection(kind: string): void {
  const graph = activeGraph();
  const nodes = selectedNodes(graph);
  if (nodes.length < 2) return;
  const before = graphSnapshot(graph);
  const left = Math.min(...nodes.map((node) => node.x));
  const right = Math.max(...nodes.map((node) => node.x + nodeSize(node).width));
  const top = Math.min(...nodes.map((node) => node.y));
  const bottom = Math.max(...nodes.map((node) => node.y + nodeSize(node).height));
  for (const node of nodes) {
    const size = nodeSize(node);
    if (kind === "left") node.x = left;
    if (kind === "center-x") node.x = (left + right - size.width) / 2;
    if (kind === "right") node.x = right - size.width;
    if (kind === "top") node.y = top;
    if (kind === "center-y") node.y = (top + bottom - size.height) / 2;
    if (kind === "bottom") node.y = bottom - size.height;
  }
  touch(graph);
  recordGraphHistory(before, "선택 노드 정렬", graph);
  render();
}

function distributeSelection(axis: "horizontal" | "vertical"): void {
  const graph = activeGraph();
  const nodes = selectedNodes(graph);
  if (nodes.length < 3) return;
  const before = graphSnapshot(graph);
  const sorted = [...nodes].sort((left, right) => axis === "horizontal" ? left.x - right.x : left.y - right.y);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const span = axis === "horizontal" ? last.x - first.x : last.y - first.y;
  sorted.forEach((node, index) => {
    const value = (axis === "horizontal" ? first.x : first.y) + span * index / (sorted.length - 1);
    if (axis === "horizontal") node.x = value; else node.y = value;
  });
  touch(graph);
  recordGraphHistory(before, "선택 노드 간격 균등", graph);
  render();
}

function fitGraph(): void {
  const active = activeGraph();
  const graph = view.layoutPreview?.graphId === active.id ? view.layoutPreview.graph : active;
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  if (!canvas || !graph.nodes.length) return;
  // Orca can mount the panel before its iframe receives a usable size. Avoid
  // persisting a bogus minimum zoom from a transient 0 x 0 canvas.
  if (canvas.clientWidth < 120 || canvas.clientHeight < 120) return;
  const bounds = graphWorldBounds(graph);
  view.zoom = Math.max(0.3, Math.min(1.25, Math.min((canvas.clientWidth - 80) / bounds.width, (canvas.clientHeight - 80) / bounds.height)));
  view.panX = (canvas.clientWidth - bounds.width * view.zoom) / 2 - bounds.x * view.zoom;
  view.panY = (canvas.clientHeight - bounds.height * view.zoom) / 2 - bounds.y * view.zoom;
  render();
}

function centerSelectedNode(): void {
  const node = selectedNode(activeGraph());
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  if (!node || !canvas || canvas.clientWidth < 120 || canvas.clientHeight < 120) return;
  const size = nodeSize(node);
  view.panX = canvas.clientWidth / 2 - (node.x + size.width / 2) * view.zoom;
  view.panY = canvas.clientHeight / 2 - (node.y + size.height / 2) * view.zoom;
  render();
}

async function chooseBridge(): Promise<void> {
  openModal({ kind: "bridge", loading: true, context: null });
  try {
    const context = await hostCall<WorkspaceContext>("workspace.readContext", {});
    view.modal = { kind: "bridge", loading: false, context };
  } catch (error) {
    view.modal = { kind: "bridge", loading: false, context: null, error: error instanceof Error ? error.message : String(error) };
  }
  render();
}

async function sendBridge<T = unknown>(payload: unknown): Promise<T | undefined> {
  if (isWideMode && wideApi) {
    const response = await fetch(wideApi, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { ok?: boolean; error?: string; value?: T };
    if (!response.ok || !result.ok) throw new Error(result.error ?? `브리지 요청 실패 (${response.status})`);
    return result.value;
  }
  if (!store.bridgeTerminalId) throw new Error("먼저 브리지 터미널을 선택하십시오.");
  const frames = encodeBridgeFrames(payload);
  if (frames.length > 128) throw new Error("Graph·Domain·Milestone·Task·Todo 데이터가 현재 패널 전송 한도를 넘었습니다. Graph 또는 업무 목록을 나누어 주십시오.");
  for (const frame of frames) {
    // Some Orca terminal backends expose a line-buffered PTY even though the
    // bridge requests raw mode. Enter commits the frame in both modes; the
    // bridge strips the trailing control character before parsing it.
    await hostCall("terminal.sendText", { terminalId: store.bridgeTerminalId, text: frame, enter: true });
  }
  return undefined;
}

async function saveStore(showNotice = true): Promise<void> {
  const result = await sendBridge<{ mode?: string; graph?: GraphDefinition; store?: GraphStore }>({ type: "save", store });
  if (result?.store) store = normalizeGraphStore(result.store);
  else if (dataSource.config.mode === "structured") activeGraph().version += 1;
  view.dirty = false;
  if (showNotice) {
    const destination = dataSource.config.mode === "structured" ? "구조화 원천" : dataSource.config.mode === "folder" ? "폴더 원천" : "로컬 브리지";
    const subject = dataSource.config.mode === "structured" ? "그래프를" : "Graph·Domain·Milestone·Task·Todo를";
    await hostCall("notifications.show", { title: "Graph Engineering", body: `${subject} ${destination}에 저장했습니다.` }).catch(() => undefined);
    toast(`${destination} 저장 요청을 보냈습니다.`);
  }
}

type SourceWorkKind = "domain" | "milestone" | "task" | "todo";

function sourceRelatedVersions(kind: SourceWorkKind, item: LocalDomain | LocalMilestone | LocalTask | LocalTodo): Record<string, number> {
  if (kind === "todo") {
    const taskId = (item as LocalTodo).taskId;
    const taskVersion = taskId ? store.tasks.find((task) => task.id === taskId)?.version : undefined;
    return taskId && Number.isInteger(taskVersion) && Number(taskVersion) > 0 ? { [taskId]: Number(taskVersion) } : {};
  }
  if (kind === "task") {
    const taskId = (item as LocalTask).id;
    const boundTodo = store.todos.find((todo) => todo.taskId === taskId);
    const todoVersion = boundTodo?.version;
    return boundTodo && Number.isInteger(todoVersion) && Number(todoVersion) > 0
      ? { [boundTodo.id]: Number(todoVersion) }
      : {};
  }
  return {};
}

function persistStructuredItem(
  kind: SourceWorkKind,
  item: LocalDomain | LocalMilestone | LocalTask | LocalTodo,
  expectedVersion: number,
  notice = "원천에 변경을 저장했습니다.",
): void {
  if (dataSource.config.mode !== "structured") return;
  const mutation = {
    kind,
    expectedVersion,
    relatedVersions: sourceRelatedVersions(kind, item),
    item: structuredClone(item),
  };
  view.dirty = false;
  void sendBridge<Partial<DataSourceState> & { store?: GraphStore }>({
    type: "mutate-source", mutation, graphId: store.activeGraphId,
  }).then((result) => {
    if (result?.store) store = normalizeGraphStore(result.store);
    if (result) dataSource = { ...dataSource, ...result, config: dataSource.config, catalog: result.catalog ?? dataSource.catalog };
    render();
    toast(isWideMode ? notice : "원천 저장 요청을 보냈습니다.");
  }).catch((error) => {
    toast(error instanceof Error ? error.message : String(error));
    void sendBridge<Partial<DataSourceState> & { store?: GraphStore }>({ type: "refresh-source", graphId: store.activeGraphId })
      .then((result) => {
        if (result?.store) store = normalizeGraphStore(result.store);
        if (result) dataSource = { ...dataSource, ...result, config: dataSource.config, catalog: result.catalog ?? [] };
        render();
      }).catch(() => undefined);
  });
}

function sourceConfigFromForm(): DataSourceConfig {
  const read = (field: string) => app.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-source-field="${field}"]`)?.value.trim() ?? "";
  const mode = read("mode") as DataSourceConfig["mode"];
  const value: DataSourceConfig = { schemaVersion: 1, mode };
  for (const field of ["folderPath", "url", "authEnv", "recordsPath", "idField", "titleField", "bodyField"] as const) {
    const text = read(field);
    if (text) value[field] = text;
  }
  return value;
}

function refreshSource(): void {
  if (view.sourceRefreshing) return;
  if (dataSource.config.mode === "local") {
    toast("외부 데이터 원천을 연결한 뒤 새로고침할 수 있습니다.");
    return;
  }
  view.sourceRefreshing = true;
  if (view.modal?.kind === "data-source") delete view.modal.error;
  render();
  void sendBridge<Partial<DataSourceState> & { store?: GraphStore }>({ type: "refresh-source", graphId: store.activeGraphId })
    .then((result) => {
      dataSource = { ...dataSource, ...result, config: dataSource.config, catalog: result?.catalog ?? [] };
      if (result?.store) store = normalizeGraphStore(result.store);
      view.sourceRefreshing = false;
      render();
      toast("데이터 원천을 새로고침했습니다.");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      view.sourceRefreshing = false;
      if (view.modal?.kind === "data-source") view.modal.error = message;
      render();
      toast(`데이터 원천 새로고침 실패: ${message}`);
    });
}

function addCatalogNode(item: DataSourceCatalogItem): void {
  const graph = activeGraph();
  const existingTaskId = item.taskId ?? (item.kind === "task" ? item.id : undefined);
  const taskId = existingTaskId ?? newId("task");
  if (graph.nodes.some((node) => node.task?.id === taskId)) {
    toast("이 Task는 현재 그래프에 이미 있습니다.");
    return;
  }
  const before = graphSnapshot(graph);
  const id = newId("NODE");
  const node: GraphNode = {
    id,
    kind: "task",
    label: item.title,
    x: 48 + (graph.nodes.length % 3) * 270,
    y: 48 + Math.floor(graph.nodes.length / 3) * 140,
    status: "pending",
    joinMode: "all",
    task: {
      id: taskId,
      title: item.title,
      prompt: item.body || item.title,
      ...(item.kind === "task" && item.version !== undefined && existingTaskId ? { version: item.version } : {}),
      metadata: { ...(item.metadata ?? {}), sourceKind: item.kind, ...(item.kind === "todo" ? { sourceTodoId: item.id } : {}) },
    },
    routing: {},
    engineering: { role: "worker", contextMode: "inherit", maxAttempts: 1, permissions: ["read"] },
  };
  graph.nodes.push(node);
  if (localWorkMutable()) upsertLocalTask(node.task);
  touch(graph);
  setNodeSelection([id], id);
  recordGraphHistory(before, "원천 Task 노드 추가", graph);
  closeModal();
  window.setTimeout(fitGraph, 0);
}

function applyImport(text: string): void {
  const parsed = JSON.parse(text) as unknown;
  const structuredVersions = new Map(store.graphs.map((graph) => [graph.id, graph.version]));
  if (typeof parsed === "object" && parsed && "schemaVersion" in parsed && (parsed as GraphStore).schemaVersion === 1) {
    store = normalizeGraphStore(parsed as GraphStore);
    if (dataSource.config.mode === "structured") {
      for (const graph of store.graphs) graph.version = structuredVersions.get(graph.id) ?? 0;
    }
  } else if (typeof parsed === "object" && parsed && "id" in parsed && "nodes" in parsed) {
    const graph = parsed as GraphDefinition;
    const normalized = normalizeGraphStore({ schemaVersion: 1, activeGraphId: graph.id, graphs: [graph] });
    const item = normalized.graphs[0];
    if (!item) throw new Error("Graph JSON에 그래프가 없습니다.");
    if (dataSource.config.mode === "structured") item.version = structuredVersions.get(item.id) ?? 0;
    store.graphs.push(item);
    store.activeGraphId = item.id;
  } else throw new Error("Graph 또는 GraphStore JSON 형식이 아닙니다.");
  clearGraphSelection();
  view.historyUndo = [];
  view.historyRedo = [];
  view.layoutPreview = null;
  view.dirty = true;
  closeModal();
  fitGraph();
}

app.addEventListener("click", (event) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const graph = activeGraph();
  const designOnlyActions = new Set([
    "new-graph", "clone-graph", "toggle-archive", "add-task", "add-condition", "add-graph-call",
    "connect-node", "quick-create-node", "remove-node", "remove-edge", "set-edge-branch", "set-edge-kind",
    "add-edge-bend", "clear-edge-bends", "duplicate-selection", "toggle-node-pin", "align-selection",
    "distribute-selection", "batch-pin", "apply-template", "apply-batch-tasks", "auto-layout", "apply-layout",
    "apply-import", "undo", "redo",
  ]);
  if (view.editorMode === "run" && action && designOnlyActions.has(action)) {
    toast("실행 보기에서는 그래프 구조를 바꿀 수 없습니다. 설계 모드로 전환하십시오.");
    return;
  }
  switch (action) {
    case "set-view": {
      const mode = target.dataset.id as ViewState["mode"] | undefined;
      if (!mode || !["canvas", "list", "domains", "milestones", "tasks", "todos"].includes(mode)) return;
      const enteringTasks = mode === "tasks" && view.mode !== "tasks";
      view.mode = mode;
      if (enteringTasks) view.taskDetailOpen = false;
      if (mode !== "canvas") {
        clearGraphSelection();
        view.inspectorOpen = false;
      }
      render();
      if (mode === "canvas") window.setTimeout(fitGraph, 0);
      break;
    }
    case "toggle-view":
      view.mode = view.mode === "canvas" ? "list" : "canvas";
      render();
      if (view.mode === "canvas") window.setTimeout(fitGraph, 0);
      break;
    case "open-list-graph": {
      const id = target.dataset.id;
      if (!id || !store.graphs.some((item) => item.id === id)) return;
      store.activeGraphId = id;
      view.mode = "canvas";
      view.graphTrail = [];
      clearGraphSelection();
      render();
      window.setTimeout(fitGraph, 0);
      break;
    }
    case "clear-list-filters":
      view.graphQuery = "";
      view.graphStatusFilter = "all";
      view.graphRunFilter = "all";
      view.graphSort = "updated-desc";
      view.graphFacet = "all";
      view.includeArchived = false;
      render();
      break;
    case "graph-facet":
      view.graphFacet = (target.dataset.id ?? "all") as ViewState["graphFacet"];
      render();
      break;
    case "toggle-work-group": {
      const groupKey = target.dataset.id;
      if (!groupKey) return;
      if (view.collapsedWorkGroups.has(groupKey)) view.collapsedWorkGroups.delete(groupKey);
      else view.collapsedWorkGroups.add(groupKey);
      render();
      break;
    }
    case "collapse-all-work-groups":
    case "expand-all-work-groups": {
      const groupKeys = [...app.querySelectorAll<HTMLElement>('[data-action="toggle-work-group"]')]
        .map((item) => item.dataset.id)
        .filter((key): key is string => Boolean(key));
      for (const groupKey of groupKeys) {
        if (action === "collapse-all-work-groups") view.collapsedWorkGroups.add(groupKey);
        else view.collapsedWorkGroups.delete(groupKey);
      }
      render();
      break;
    }
    case "new-domain": {
      if (!localWorkMutable()) return;
      const now = new Date().toISOString();
      const domain: LocalDomain = {
        id: newId("domain"), name: "새 Domain", summary: "", objectives: "", commonNotes: "", constraintNotes: "",
        status: "active", owners: [], version: dataSource.config.mode === "structured" ? 0 : 1, createdAt: now, updatedAt: now,
      };
      store.domains.push(domain);
      view.selectedDomainId = domain.id;
      view.mode = "domains";
      view.dirty = true;
      render();
      persistStructuredItem("domain", domain, 0, "Domain을 원천에 만들었습니다.");
      break;
    }
    case "new-milestone": {
      if (!localWorkMutable()) return;
      const domain = store.domains.find((item) => item.id === view.selectedDomainId && item.status !== "archived")
        ?? store.domains.find((item) => item.status !== "archived");
      if (!domain) { toast("먼저 활성 Domain을 만드십시오."); return; }
      const now = new Date().toISOString();
      const milestone: LocalMilestone = {
        id: newId("milestone"), domainId: domain.id, name: "새 Milestone", summary: "", objectives: "", commonNotes: "", constraintNotes: "",
        status: "active", priority: "medium", successCriteria: [], owners: [], version: dataSource.config.mode === "structured" ? 0 : 1, createdAt: now, updatedAt: now,
      };
      store.milestones.push(milestone);
      view.selectedMilestoneId = milestone.id;
      view.mode = "milestones";
      view.dirty = true;
      render();
      persistStructuredItem("milestone", milestone, 0, "Milestone을 원천에 만들었습니다.");
      break;
    }
    case "select-domain": view.selectedDomainId = target.dataset.id ?? null; render(); break;
    case "select-milestone": view.selectedMilestoneId = target.dataset.id ?? null; render(); break;
    case "archive-domain": {
      const domain = store.domains.find((item) => item.id === target.dataset.id);
      if (!domain || !localWorkMutable()) return;
      const expectedVersion = domain.version;
      if (domain.status === "archived") {
        domain.status = "active";
        touchScope(domain);
      } else {
        const milestoneIds = new Set(store.milestones.filter((item) => item.domainId === domain.id).map((item) => item.id));
        const activeMilestone = store.milestones.some((item) => item.domainId === domain.id && !["completed", "archived"].includes(item.status));
        const activeTask = store.tasks.some((item) => (item.domainId === domain.id || (item.milestoneId ? milestoneIds.has(item.milestoneId) : false)) && !["done", "archived"].includes(item.status));
        const activeTodo = store.todos.some((item) => (item.domainId === domain.id || (item.milestoneId ? milestoneIds.has(item.milestoneId) : false)) && !["done", "cancelled"].includes(item.status));
        if (activeMilestone || activeTask || activeTodo) { toast("활성 Milestone·Task·Todo를 먼저 완료하거나 보관하십시오."); return; }
        domain.status = "archived";
        touchScope(domain);
      }
      render();
      persistStructuredItem("domain", domain, expectedVersion);
      break;
    }
    case "archive-milestone": {
      const milestone = store.milestones.find((item) => item.id === target.dataset.id);
      if (!milestone || !localWorkMutable()) return;
      const expectedVersion = milestone.version;
      if (milestone.status === "archived") {
        if (domainFor(milestone.domainId)?.status === "archived") { toast("먼저 상위 Domain을 복원하십시오."); return; }
        milestone.status = "active";
        touchScope(milestone);
      } else {
        const activeTask = store.tasks.some((item) => item.milestoneId === milestone.id && !["done", "archived"].includes(item.status));
        const activeTodo = store.todos.some((item) => item.milestoneId === milestone.id && !["done", "cancelled"].includes(item.status));
        if (activeTask || activeTodo) { toast("활성 Task·Todo를 먼저 완료하거나 보관하십시오."); return; }
        milestone.status = "archived";
        touchScope(milestone);
      }
      render();
      persistStructuredItem("milestone", milestone, expectedVersion);
      break;
    }
    case "new-local-task": {
      if (!localWorkMutable()) return;
      const now = new Date().toISOString();
      const task: LocalTask = {
        id: newId("task"), title: "새 Task", prompt: "수행할 작업과 완료 조건을 입력하십시오.",
        draft: "수행할 작업과 완료 조건을 입력하십시오.", promptRevisions: [],
        status: "backlog", priority: "medium", tags: [],
        ...(dataSource.config.mode === "structured" ? { version: 0 } : {}),
        createdAt: now, updatedAt: now,
      };
      task.promptRevisions.push({ id: `${task.id}:draft:${crypto.randomUUID()}`, kind: "draft", revision: 1, content: task.draft, status: "current", generator: "human", createdAt: now });
      if (view.workDomainFilter !== "all" && view.workDomainFilter !== "standalone" && domainFor(view.workDomainFilter)) task.domainId = view.workDomainFilter;
      if (view.workMilestoneFilter !== "all" && view.workMilestoneFilter !== "none") {
        const milestone = milestoneFor(view.workMilestoneFilter);
        if (milestone) { task.domainId = milestone.domainId; task.milestoneId = milestone.id; }
      }
      store.tasks.push(task);
      view.selectedTaskId = task.id;
      view.taskDetailOpen = true;
      view.mode = "tasks";
      view.dirty = true;
      render();
      persistStructuredItem("task", task, 0, "Task를 원천에 만들었습니다.");
      break;
    }
    case "new-local-todo": {
      if (!localWorkMutable()) return;
      const now = new Date().toISOString();
      const todo: LocalTodo = {
        id: newId("todo"), title: "새 Todo", notes: "", draft: "할 일과 완료 조건을 입력하십시오.", promptRevisions: [], status: "open",
        priority: "medium", tags: [],
        ...(dataSource.config.mode === "structured" ? { version: 0 } : {}),
        createdAt: now, updatedAt: now,
      };
      todo.promptRevisions.push({ id: `${todo.id}:draft:${crypto.randomUUID()}`, kind: "draft", revision: 1, content: todo.draft, status: "current", generator: "human", createdAt: now });
      if (view.workDomainFilter !== "all" && view.workDomainFilter !== "standalone" && domainFor(view.workDomainFilter)) todo.domainId = view.workDomainFilter;
      if (view.workMilestoneFilter !== "all" && view.workMilestoneFilter !== "none") {
        const milestone = milestoneFor(view.workMilestoneFilter);
        if (milestone) { todo.domainId = milestone.domainId; todo.milestoneId = milestone.id; }
      }
      store.todos.push(todo);
      view.selectedTodoId = todo.id;
      view.mode = "todos";
      view.dirty = true;
      render();
      persistStructuredItem("todo", todo, 0, "Todo를 원천에 만들었습니다.");
      break;
    }
    case "select-local-task":
      view.selectedTaskId = target.dataset.id ?? null;
      view.taskDetailOpen = Boolean(view.selectedTaskId);
      render();
      break;
    case "back-to-task-list":
      view.taskDetailOpen = false;
      render();
      window.setTimeout(() => app.querySelector<HTMLElement>(`[data-action="select-local-task"][data-id="${selectorEscape(view.selectedTaskId ?? "")}"]`)?.focus(), 0);
      break;
    case "select-local-todo":
      view.selectedTodoId = target.dataset.id ?? null;
      render();
      break;
    case "request-meta-prompt": {
      const kind = target.dataset.kind as "task" | "todo" | undefined;
      const item = kind === "task"
        ? store.tasks.find((candidate) => candidate.id === target.dataset.id)
        : kind === "todo" ? store.todos.find((candidate) => candidate.id === target.dataset.id) : undefined;
      if (!kind || !item || !localWorkMutable()) return;
      const revision = currentDraftRevision(item);
      if (!revision || !item.draft.trim()) { toast("사람 Draft를 먼저 작성하십시오."); return; }
      if (!store.bridgeTerminalId) { toast("먼저 브리지 터미널을 연결하십시오."); return; }
      item.metaPromptRun = { status: "running", requestedAt: new Date().toISOString(), draftRevisionId: revision.id };
      touchWorkItem(item);
      render();
      const prepare = dataSource.config.mode === "structured" ? Promise.resolve() : saveStore(false);
      void prepare
        .then(() => sendBridge<Partial<DataSourceState> & { store?: GraphStore }>({ type: "meta-prompt", itemKind: kind, itemId: item.id, draftRevisionId: revision.id }))
        .then((result) => {
          if (result?.store) store = normalizeGraphStore(result.store);
          if (result) dataSource = { ...dataSource, ...result, config: dataSource.config, catalog: result.catalog ?? dataSource.catalog };
          render();
          toast(isWideMode ? "Meta Prompt를 생성했습니다." : "Meta Prompt 생성을 요청했습니다. 완료되면 패널을 새로고침하십시오.");
        })
        .catch((error) => {
          item.metaPromptRun = { ...item.metaPromptRun!, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
          touchWorkItem(item);
          render();
          toast(error instanceof Error ? error.message : String(error));
        });
      break;
    }
    case "add-local-task-node": {
      const task = store.tasks.find((item) => item.id === target.dataset.id);
      if (task) addLocalTaskNode(task);
      break;
    }
    case "add-source-item-from-manager": {
      const item = dataSource.catalog.find((candidate) => candidate.id === target.dataset.id);
      if (!item) return;
      view.mode = "canvas";
      addCatalogNode(item);
      toast(`${item.title} 항목을 현재 그래프에 추가했습니다.`);
      break;
    }
    case "open-task-node": {
      const graphId = target.dataset.graphId;
      const nodeId = target.dataset.id;
      if (!graphId || !nodeId || !store.graphs.some((item) => item.id === graphId)) return;
      store.activeGraphId = graphId;
      view.mode = "canvas";
      setNodeSelection([nodeId], nodeId);
      view.inspectorOpen = true;
      view.inspectorTab = "task";
      render();
      window.setTimeout(fitGraph, 0);
      break;
    }
    case "edit-managed-task": {
      const id = target.dataset.id;
      if (!id || !store.tasks.some((task) => task.id === id)) return;
      clearGraphSelection();
      view.inspectorOpen = false;
      view.selectedTaskId = id;
      view.taskDetailOpen = true;
      view.mode = "tasks";
      render();
      break;
    }
    case "open-task-delete": {
      const task = store.tasks.find((item) => item.id === target.dataset.id && item.status !== "archived");
      if (!task || !localWorkMutable()) return;
      openModal({ kind: "task-delete", taskId: task.id });
      break;
    }
    case "confirm-task-delete": {
      if (view.modal?.kind !== "task-delete") return;
      const taskId = view.modal.taskId;
      const task = store.tasks.find((item) => item.id === taskId);
      if (!task || !localWorkMutable()) return;
      const expectedVersion = Number(task.version ?? 0);
      task.status = "archived";
      touchWorkItem(task);
      closeModal();
      toast("Task를 보관했습니다. 필요하면 Task 복원으로 되돌릴 수 있습니다.");
      persistStructuredItem("task", task, expectedVersion, "Task를 원천에서 보관했습니다.");
      break;
    }
    case "archive-local-task": {
      const task = store.tasks.find((item) => item.id === target.dataset.id);
      if (!task || !localWorkMutable()) return;
      const expectedVersion = Number(task.version ?? 0);
      if (task.status !== "archived") return;
      task.status = "backlog";
      touchWorkItem(task);
      render();
      persistStructuredItem("task", task, expectedVersion, "Task를 원천에서 복원했습니다.");
      break;
    }
    case "promote-todo": {
      const todo = store.todos.find((item) => item.id === target.dataset.id);
      if (!todo || !localWorkMutable()) return;
      const todoExpectedVersion = Number(todo.version ?? 0);
      let task = todo.taskId ? store.tasks.find((item) => item.id === todo.taskId) : undefined;
      let createdTask = false;
      if (!task) {
        createdTask = true;
        const now = new Date().toISOString();
        const taskId = newId("task");
        const revisionIds = new Map(todo.promptRevisions.map((revision) => [revision.id, `${taskId}:${revision.kind}:${crypto.randomUUID()}`]));
        task = {
          id: taskId, title: todo.title, prompt: currentMetaRevision(todo)?.content || todo.draft,
          ...(todo.domainId ? { domainId: todo.domainId } : {}),
          ...(todo.milestoneId ? { milestoneId: todo.milestoneId } : {}),
          draft: todo.draft,
          ...(todo.metaDraft ? { metaDraft: todo.metaDraft } : {}),
          promptRevisions: todo.promptRevisions.map((revision) => ({
            ...revision,
            id: revisionIds.get(revision.id)!,
            ...(revision.basedOnId && revisionIds.get(revision.basedOnId) ? { basedOnId: revisionIds.get(revision.basedOnId)! } : {}),
          })),
          status: "backlog", priority: todo.priority, ...(todo.dueDate ? { dueDate: todo.dueDate } : {}),
          tags: [...todo.tags], createdAt: now, updatedAt: now,
          ...(dataSource.config.mode === "structured" ? { version: 0 } : {}),
        };
        store.tasks.push(task);
        todo.taskId = task.id;
        touchWorkItem(todo);
      }
      view.selectedTaskId = task.id;
      view.taskDetailOpen = true;
      view.mode = "tasks";
      view.dirty = true;
      render();
      if (task && createdTask && dataSource.config.mode === "structured") {
        persistStructuredItem("task", task, Number(task.version ?? 0), "Todo에서 Task를 만들었습니다.");
        persistStructuredItem("todo", todo, todoExpectedVersion, "Todo와 Task를 연결했습니다.");
      }
      break;
    }
    case "open-linked-task": {
      const id = target.dataset.id;
      if (!id || !store.tasks.some((task) => task.id === id)) return;
      view.selectedTaskId = id;
      view.taskDetailOpen = true;
      view.mode = "tasks";
      render();
      break;
    }
    case "toggle-todo-done": {
      const todo = store.todos.find((item) => item.id === target.dataset.id);
      if (!todo || !localWorkMutable()) return;
      const expectedVersion = Number(todo.version ?? 0);
      todo.status = todo.status === "done" ? "open" : "done";
      touchWorkItem(todo);
      render();
      persistStructuredItem("todo", todo, expectedVersion);
      break;
    }
    case "cancel-local-todo": {
      const todo = store.todos.find((item) => item.id === target.dataset.id);
      if (!todo || !localWorkMutable()) return;
      const expectedVersion = Number(todo.version ?? 0);
      todo.status = todo.status === "cancelled" ? "open" : "cancelled";
      touchWorkItem(todo);
      render();
      persistStructuredItem("todo", todo, expectedVersion);
      break;
    }
    case "copy-graph-id":
      void navigator.clipboard.writeText(target.dataset.id ?? graph.id).then(() => toast("그래프 ID를 복사했습니다.")).catch(() => toast("ID 복사에 실패했습니다."));
      break;
    case "toggle-archive": {
      const before = graphSnapshot(graph);
      graph.status = graph.status === "archived" ? "draft" : "archived";
      touch(graph); recordGraphHistory(before, graph.status === "archived" ? "그래프 보관" : "그래프 보관 해제", graph); render();
      break;
    }
    case "open-child-graph": {
      const id = target.dataset.id;
      if (!id || !store.graphs.some((item) => item.id === id)) return;
      view.graphTrail.push(graph.id);
      store.activeGraphId = id; clearGraphSelection(); render(); window.setTimeout(fitGraph, 0);
      break;
    }
    case "open-trail-graph": {
      const id = target.dataset.id;
      const index = Number(target.dataset.index);
      if (!id || !Number.isInteger(index) || !store.graphs.some((item) => item.id === id)) return;
      store.activeGraphId = id;
      view.graphTrail = view.graphTrail.slice(0, index);
      clearGraphSelection();
      render(); window.setTimeout(fitGraph, 0);
      break;
    }
    case "select-node": {
      const id = target.dataset.id;
      if (!id) return;
      if (view.connectingFrom) connectTo(id);
      else {
        const mouse = event as MouseEvent;
        const additive = mouse.metaKey || mouse.ctrlKey || mouse.shiftKey;
        if (additive) {
          const ids = new Set(view.selectedNodeIds);
          if (ids.has(id)) ids.delete(id); else ids.add(id);
          setNodeSelection([...ids], ids.has(id) ? id : [...ids].at(-1) ?? null);
        } else if (!view.selectedNodeIds.includes(id)) setNodeSelection([id], id);
        else view.selectedNodeId = id;
        view.inspectorOpen = true;
        if (!additive) view.inspectorTab = "task";
        render();
      }
      break;
    }
    case "edit-node": {
      const id = target.dataset.id;
      const node = graph.nodes.find((item) => item.id === id);
      if (!node) return;
      setNodeSelection([node.id], node.id);
      view.selectedEdgeId = null;
      view.inspectorOpen = true;
      view.inspectorTab = "task";
      render();
      window.setTimeout(() => app.querySelector<HTMLElement>('.inspector [data-inspector-panel="task"] input, .inspector [data-inspector-panel="task"] textarea, .inspector [data-inspector-panel="task"] select')?.focus(), 0);
      break;
    }
    case "select-edge":
      view.selectedEdgeId = target.dataset.id ?? null;
      view.selectedNodeIds = [];
      view.selectedNodeId = null;
      view.inspectorOpen = true;
      render();
      break;
    case "add-task": if (view.editorMode === "design") addNode("task"); break;
    case "add-condition": if (view.editorMode === "design") addNode("condition"); break;
    case "add-graph-call": if (view.editorMode === "design") addNode("graph_call"); break;
    case "connect-node":
      view.connectingFrom = view.connectingFrom === view.selectedNodeId ? null : view.selectedNodeId;
      view.connectionPointer = null;
      render();
      break;
    case "quick-create-node": {
      const quick = view.quickCreate;
      const kind = target.dataset.kind as GraphNode["kind"] | undefined;
      if (!quick || !kind || !["task", "condition", "graph_call"].includes(kind)) return;
      const from = quick.fromNodeId;
      view.quickCreate = null;
      const node = addNode(kind, { x: quick.x, y: quick.y });
      if (from) {
        view.connectingFrom = from;
        connectTo(node.id);
      }
      break;
    }
    case "cancel-quick-create": view.quickCreate = null; view.connectingFrom = null; render(); break;
    case "remove-node": removeSelectedNode(); break;
    case "remove-edge": removeSelectedEdge(); break;
    case "set-edge-branch": {
      const edge = selectedEdge(graph);
      if (!edge) return;
      const before = graphSnapshot(graph);
      edge.branch = target.dataset.id ?? "y";
      touch(graph); recordGraphHistory(before, "분기 라벨 변경", graph); render();
      break;
    }
    case "set-edge-kind": {
      const edge = selectedEdge(graph);
      if (!edge) return;
      const before = graphSnapshot(graph);
      edge.kind = target.dataset.id === "loop" ? "loop" : "sequence";
      if (edge.kind === "loop" && !edge.branch) edge.branch = "n";
      touch(graph); recordGraphHistory(before, "연결 종류 변경", graph); render();
      break;
    }
    case "add-edge-bend": {
      const edge = selectedEdge(graph);
      const geometry = edge ? edgePath(edge, graph) : null;
      if (!edge || !geometry) return;
      const before = graphSnapshot(graph);
      const editor = editorPolicy(graph);
      editor.edgeWaypoints ??= {};
      const points = editor.edgeWaypoints[edge.id] ?? [];
      points.push({ x: Math.round(geometry.labelX / GRID) * GRID, y: Math.round((geometry.labelY + 10) / GRID) * GRID });
      editor.edgeWaypoints[edge.id] = points;
      touch(graph); recordGraphHistory(before, "연결 꺾임점 추가", graph); render();
      break;
    }
    case "clear-edge-bends": {
      const edge = selectedEdge(graph);
      if (!edge || !graph.engineering?.editor?.edgeWaypoints?.[edge.id]) return;
      const before = graphSnapshot(graph);
      delete graph.engineering.editor.edgeWaypoints[edge.id];
      touch(graph); recordGraphHistory(before, "연결 꺾임점 초기화", graph); render();
      break;
    }
    case "clear-selection":
      clearGraphSelection(); view.inspectorOpen = false; render();
      break;
    case "inspector-tab":
      view.inspectorTab = (target.dataset.id ?? "basic") as InspectorTab; render(); break;
    case "editor-mode":
      view.editorMode = target.dataset.id === "run" ? "run" : "design";
      clearGraphSelection(); render(); break;
    case "undo": undoGraphChange(); break;
    case "redo": redoGraphChange(); break;
    case "duplicate-selection": if (view.editorMode === "design") duplicateSelection(); break;
    case "toggle-node-pin": {
      const nodes = selectedNodes(graph);
      if (!nodes.length || view.editorMode !== "design") return;
      const before = graphSnapshot(graph);
      const pin = !nodes.every((node) => node.engineering?.layoutPinned);
      for (const node of nodes) { node.engineering ??= {}; node.engineering.layoutPinned = pin; }
      touch(graph); recordGraphHistory(before, pin ? "노드 위치 고정" : "노드 위치 고정 해제", graph); render();
      break;
    }
    case "gate-decision": {
      const node = selectedNode(graph) ?? graph.nodes.find((item) => target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId === item.id);
      const decision = target.dataset.id;
      if (!node || node.engineering?.role !== "human_gate" || !["approved", "rejected"].includes(decision ?? "")) return;
      const before = graphSnapshot(graph);
      node.engineering.approvalStatus = decision as "approved" | "rejected";
      touch(graph); recordGraphHistory(before, decision === "approved" ? "Human gate 승인" : "Human gate 거절", graph); render();
      break;
    }
    case "toggle-inspector": view.inspectorOpen = !view.inspectorOpen; render(); break;
    case "toggle-problems": view.problemsOpen = !view.problemsOpen; render(); break;
    case "focus-problem": {
      const id = target.dataset.id;
      if (id && graph.nodes.some((node) => node.id === id)) {
        setNodeSelection([id], id);
        view.inspectorOpen = true;
        view.inspectorTab = "safety";
        view.problemsOpen = false;
        render(); window.setTimeout(centerSelectedNode, 0);
      } else {
        view.selectedNodeIds = []; view.selectedNodeId = null; view.selectedEdgeId = null;
        view.inspectorOpen = true; view.problemsOpen = false; render();
      }
      break;
    }
    case "open-shortcuts": openModal({ kind: "shortcuts" }); break;
    case "show-analysis":
      clearGraphSelection(); view.inspectorOpen = true; view.inspectorTab = "basic"; render();
      window.setTimeout(() => app.querySelector(".engineering-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      break;
    case "toggle-minimap": view.showMinimap = !view.showMinimap; render(); break;
    case "toggle-layout": view.layoutDirection = view.layoutDirection === "LR" ? "TB" : "LR"; render(); break;
    case "align-selection": alignSelection(target.dataset.id ?? "left"); break;
    case "distribute-selection": distributeSelection(target.dataset.id === "vertical" ? "vertical" : "horizontal"); break;
    case "batch-pin": {
      const nodes = selectedNodes(graph);
      if (!nodes.length) return;
      const before = graphSnapshot(graph);
      const checked = target instanceof HTMLInputElement ? target.checked : !nodes.every((node) => node.engineering?.layoutPinned);
      for (const node of nodes) { node.engineering ??= {}; node.engineering.layoutPinned = checked; }
      touch(graph); recordGraphHistory(before, checked ? "선택 위치 고정" : "선택 위치 고정 해제", graph); render();
      break;
    }
    case "open-templates": openModal({ kind: "templates" }); break;
    case "open-batch-tasks": openModal({ kind: "batch-tasks", text: "" }); break;
    case "open-history": openModal({ kind: "history" }); break;
    case "open-data-source": openModal({ kind: "data-source" }); break;
    case "save-source": {
      try {
        const config = sourceConfigFromForm();
        void sendBridge<Partial<DataSourceState> & { store?: GraphStore }>({ type: "configure-source", config, store })
          .then((result) => {
            dataSource = { ...dataSource, ...result, config, catalog: result?.catalog ?? dataSource.catalog };
            if (result?.store) store = normalizeGraphStore(result.store);
            closeModal();
            toast("데이터 원천 설정을 저장했습니다. 사이드 패널은 새로고침 후 최신 snapshot을 표시합니다.");
          })
          .catch((error) => {
            if (view.modal?.kind === "data-source") view.modal.error = error instanceof Error ? error.message : String(error);
            render();
          });
      } catch (error) {
        if (view.modal?.kind === "data-source") view.modal.error = error instanceof Error ? error.message : String(error);
        render();
      }
      break;
    }
    case "refresh-source": refreshSource(); break;
    case "apply-template": {
      const id = target.dataset.id as TopologyKind | undefined;
      if (!id || !TOPOLOGY_TEMPLATES.some((item) => item.id === id)) return;
      if (graph.nodes.length && !window.confirm("현재 노드와 연결을 선택한 topology로 교체할까요?")) return;
      const before = graphSnapshot(graph);
      const index = store.graphs.findIndex((item) => item.id === graph.id);
      const templated = applyTopologyTemplate(graph, id);
      if (dataSource.config.mode === "structured") templated.version = graph.version;
      store.graphs[index] = templated;
      clearGraphSelection(); view.dirty = true; recordGraphHistory(before, "Topology 템플릿 적용", templated); closeModal(); window.setTimeout(fitGraph, 0);
      break;
    }
    case "apply-batch-tasks": {
      const editor = app.querySelector<HTMLTextAreaElement>("[data-batch-editor]");
      const labels = (editor?.value ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (!labels.length) {
        if (view.modal?.kind === "batch-tasks") view.modal.error = "추가할 Task 제목을 한 줄 이상 입력하십시오.";
        render(); return;
      }
      addBatchTasks(labels); closeModal(); window.setTimeout(fitGraph, 0);
      break;
    }
    case "new-graph": {
      const id = newId("graph");
      const now = new Date().toISOString();
      store.graphs.push({
        id, name: "새 그래프", summary: "", status: "draft", version: dataSource.config.mode === "structured" ? 0 : 1, pinned: false,
        routineEnabled: false, repeatMode: "none", defaults: {},
        runGuards: { claimLeaseSeconds: 21600, stagnationRuns: 3 },
        engineering: { checkpointPolicy: "superstep", requireProvenance: true, humanGateForIrreversible: true, maturity: "experimental" },
        nodes: [], edges: [], runs: [], createdAt: now, updatedAt: now,
      });
      store.activeGraphId = id;
      view.mode = "canvas"; view.graphTrail = []; clearGraphSelection(); view.dirty = true; render();
      break;
    }
    case "clone-graph": {
      const cloned = cloneGraph(graph, newId("graph"));
      if (dataSource.config.mode === "structured") cloned.version = 0;
      store.graphs.push(cloned); store.activeGraphId = cloned.id; view.graphTrail = []; view.dirty = true; clearGraphSelection(); render(); fitGraph();
      break;
    }
    case "auto-layout": {
      const nodeIds = view.selectedNodeIds.length ? [...view.selectedNodeIds] : graph.nodes.map((node) => node.id);
      const laidOut = autoLayout(graph, view.layoutDirection, { ...(view.selectedNodeIds.length ? { nodeIds } : {}), preservePinned: true });
      if (dataSource.config.mode === "structured") laidOut.version = graph.version;
      view.layoutPreview = { graphId: graph.id, graph: laidOut, nodeIds };
      render(); fitGraph();
      break;
    }
    case "apply-layout": {
      const preview = view.layoutPreview;
      if (!preview || preview.graphId !== graph.id) return;
      const before = graphSnapshot(graph);
      const index = store.graphs.findIndex((item) => item.id === graph.id);
      const applied = structuredClone(preview.graph);
      if (dataSource.config.mode === "structured") applied.version = graph.version;
      else applied.version = graph.version + 1;
      applied.updatedAt = new Date().toISOString();
      store.graphs[index] = applied;
      view.layoutPreview = null;
      view.dirty = true;
      recordGraphHistory(before, preview.nodeIds.length === graph.nodes.length ? "전체 자동 정렬" : "선택 자동 정렬", applied);
      render(); fitGraph();
      break;
    }
    case "cancel-layout": view.layoutPreview = null; render(); fitGraph(); break;
    case "reset-run": {
      const before = graphSnapshot(graph);
      resetGraphRunState(graph);
      touch(graph); recordGraphHistory(before, "실행 상태 리셋", graph); render(); break;
    }
    case "clear-stale-run": {
      const item = store.graphs.find((candidate) => candidate.id === target.dataset.id);
      if (!item || graphRunStage(item) !== "stale") return;
      store.activeGraphId = item.id;
      const before = graphSnapshot(item);
      resetGraphRunState(item);
      touch(item);
      recordGraphHistory(before, "남은 실행 상태 정리", item);
      render();
      toast("남은 실행 상태를 취소로 마감했습니다. 저장하면 데이터 원천에도 반영됩니다.");
      break;
    }
    case "zoom-in": view.zoom = Math.min(1.8, view.zoom + .1); render(); break;
    case "zoom-out": view.zoom = Math.max(.25, view.zoom - .1); render(); break;
    case "zoom-reset": view.zoom = 1; render(); break;
    case "center-selection": centerSelectedNode(); break;
    case "fit": fitGraph(); break;
    case "open-wide":
      void saveStore(false)
        .then(() => sendBridge({ type: "open-wide" }))
        .then(() => toast("Orca 중앙 탭에서 넓게 보기를 열고 있습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    case "connect-bridge": void chooseBridge(); break;
    case "choose-terminal": {
      const terminalId = target.dataset.id;
      if (!terminalId) return;
      store.bridgeTerminalId = terminalId;
      if (view.modal?.kind === "bridge" && view.modal.context) store.bridgeWorkspace = view.modal.context.displayName;
      view.dirty = true; render(); break;
    }
    case "start-bridge": {
      if (!store.bridgeTerminalId) return;
      const command = `node ${JSON.stringify(`${bootstrap.pluginRoot}/bridge/index.mjs`)}`;
      void hostCall("terminal.sendText", { terminalId: store.bridgeTerminalId, text: command, enter: true })
        .then(() => { closeModal(); toast("브리지 시작 명령을 보냈습니다. 1초 뒤 저장해 보십시오."); })
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "save": void saveStore().catch((error) => toast(error instanceof Error ? error.message : String(error))); break;
    case "refresh-targets":
      void sendBridge<OrcaTargets>({ type: "refresh" }).then((result) => {
        if (result) targets = result;
        render();
        toast(isWideMode ? "Orca 환경·프로젝트·세션을 갱신했습니다." : "Orca 대상 갱신을 요청했습니다.");
      }).catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    case "open-task-run": {
      const task = store.tasks.find((item) => item.id === target.dataset.id);
      if (!task) return;
      openModal(createTaskRunModal(task));
      break;
    }
    case "confirm-task-run": {
      if (view.modal?.kind !== "task-run") return;
      const taskId = view.modal.taskId;
      const routing = routingValue(view.modal.routing);
      const prepare = dataSource.config.mode === "structured" ? Promise.resolve() : saveStore(false);
      closeModal();
      void prepare
        .then(() => sendBridge<{ sessionId?: string }>({ type: "run-task", taskId, routing, dryRun: false }))
        .then((result) => toast(result?.sessionId ? `Task 실행을 마쳤습니다 · ${result.sessionId}` : "Task 단건 실행을 요청했습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "open-plan": openModal(createRunModal(false)); break;
    case "open-run": openModal(createRunModal(true)); break;
    case "confirm-run": {
      if (view.modal?.kind !== "run") return;
      const modal = view.modal;
      const live = modal.live;
      applyRunDraft(graph, modal);
      closeModal();
      void saveStore(false)
        .then(() => sendBridge({ type: "run", graphId: graph.id, dryRun: !live }))
        .then(() => toast(live ? "그래프 실행을 요청했습니다." : "실행 계획 생성을 요청했습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "export-json": openModal({ kind: "json", mode: "export", text: JSON.stringify(graph, null, 2) }); break;
    case "import-json": openModal({ kind: "json", mode: "import", text: "" }); break;
    case "apply-import": {
      const editor = app.querySelector<HTMLTextAreaElement>("[data-json-editor]");
      try { applyImport(editor?.value ?? ""); }
      catch (error) {
        if (view.modal?.kind === "json") view.modal.error = error instanceof Error ? error.message : String(error);
        render();
      }
      break;
    }
    case "close-modal": closeModal(); break;
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const actionable = (event.target as Element).closest<Element>('[role="button"][data-action]');
  if (!actionable || !app.contains(actionable)) return;
  event.preventDefault();
  actionable.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});

app.addEventListener("change", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-field]");
  if (!input) return;
  const graph = activeGraph();
  const beforeGraph = graphSnapshot(graph);
  const node = selectedNode(graph);
  const edge = selectedEdge(graph);
  const scope = input.dataset.scope;
  const field = input.dataset.field;
  if (!field) return;
  if (view.editorMode === "run" && ["graph", "graph-routing", "guard", "graph-engineering", "graph-editor", "node", "task", "node-routing", "node-engineering", "node-permission", "multi-node-routing", "multi-node-engineering", "edge", "edge-endpoint"].includes(scope ?? "")) {
    toast("실행 보기의 Inspector는 읽기 전용입니다.");
    render();
    return;
  }
  const raw = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
  if (scope === "task-run-routing" && view.modal?.kind === "task-run") {
    if (raw) (view.modal.routing as Record<string, unknown>)[field] = raw;
    else delete (view.modal.routing as Record<string, unknown>)[field];
    if (field === "environmentId") {
      delete view.modal.routing.projectId;
      delete view.modal.routing.sessionId;
      delete view.modal.routing.reasoning;
    } else if (field === "sessionId" && typeof raw === "string" && raw) {
      const environmentId = routeEnvironmentId(view.modal.routing.environmentId);
      const session = targets.sessions.find((item) => item.id === raw && routeEnvironmentId(item.environmentId) === environmentId);
      const matchingModel = targets.models.find((item) => item.agent === session?.agentType);
      if (matchingModel) view.modal.routing.model = matchingModel.id;
      delete view.modal.routing.reasoning;
    }
    render();
    return;
  } else if (scope === "run-routing" && view.modal?.kind === "run") {
    if (raw) (view.modal.defaults as Record<string, unknown>)[field] = raw;
    else delete (view.modal.defaults as Record<string, unknown>)[field];
    if (field === "sessionId" && typeof raw === "string" && raw) {
      const session = targets.sessions.find((item) => item.id === raw);
      const matchingModel = targets.models.find((item) => item.agent === session?.agentType);
      if (matchingModel) view.modal.defaults.model = matchingModel.id;
      delete view.modal.defaults.reasoning;
    }
    render();
    return;
  } else if (scope === "run-node-routing" && view.modal?.kind === "run") {
    const nodeId = input.dataset.nodeId;
    if (!nodeId || !graph.nodes.some((item) => item.id === nodeId)) return;
    const routing = view.modal.nodeRouting[nodeId] ??= {};
    if (raw) (routing as Record<string, unknown>)[field] = raw;
    else delete (routing as Record<string, unknown>)[field];
    if (field === "sessionId" && typeof raw === "string" && raw) {
      const session = targets.sessions.find((item) => item.id === raw);
      const matchingModel = targets.models.find((item) => item.agent === session?.agentType);
      if (matchingModel) routing.model = matchingModel.id;
      delete routing.reasoning;
    }
    render();
    return;
  } else if (scope === "run-condition" && view.modal?.kind === "run") {
    const nodeId = input.dataset.nodeId;
    if (!nodeId) return;
    view.modal.conditionBranches[nodeId] = typeof raw === "string" ? raw : "";
    render();
    return;
  } else if (scope === "local-task") {
    const task = store.tasks.find((item) => item.id === view.selectedTaskId);
    if (!task || !localWorkMutable()) return;
    const expectedVersion = Number(task.version ?? 0);
    if (field === "draft") {
      if (setHumanDraft(task, input.value)) syncTaskToGraphNodes(task);
      render();
      persistStructuredItem("task", task, expectedVersion);
      return;
    } else if (field === "domainId") {
      if (input.value) task.domainId = input.value; else delete task.domainId;
      if (task.milestoneId && milestoneFor(task.milestoneId)?.domainId !== task.domainId) delete task.milestoneId;
    } else if (field === "milestoneId") {
      const milestone = milestoneFor(input.value);
      if (milestone) { task.domainId = milestone.domainId; task.milestoneId = milestone.id; }
      else delete task.milestoneId;
    } else if (field === "tags") task.tags = input.value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (field === "dueDate") {
      if (input.value) task.dueDate = input.value; else delete task.dueDate;
    } else (task as unknown as Record<string, unknown>)[field] = raw;
    if (field === "title") syncTaskToGraphNodes(task);
    else touchWorkItem(task);
    render();
    persistStructuredItem("task", task, expectedVersion);
    return;
  } else if (scope === "local-todo") {
    const todo = store.todos.find((item) => item.id === view.selectedTodoId);
    if (!todo || !localWorkMutable()) return;
    const expectedVersion = Number(todo.version ?? 0);
    if (field === "draft") {
      setHumanDraft(todo, input.value);
      render();
      persistStructuredItem("todo", todo, expectedVersion);
      return;
    } else if (field === "domainId") {
      if (input.value) todo.domainId = input.value; else delete todo.domainId;
      if (todo.milestoneId && milestoneFor(todo.milestoneId)?.domainId !== todo.domainId) delete todo.milestoneId;
    } else if (field === "milestoneId") {
      const milestone = milestoneFor(input.value);
      if (milestone) { todo.domainId = milestone.domainId; todo.milestoneId = milestone.id; }
      else delete todo.milestoneId;
    } else if (field === "tags") todo.tags = input.value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (field === "subgroupName") todo.subgroupName = input.value;
    else if (field === "dueDate" || field === "taskId" || field === "groupName") {
      if (input.value) (todo as unknown as Record<string, unknown>)[field] = input.value;
      else delete (todo as unknown as Record<string, unknown>)[field];
    } else (todo as unknown as Record<string, unknown>)[field] = raw;
    touchWorkItem(todo);
    render();
    persistStructuredItem("todo", todo, expectedVersion);
    return;
  } else if (scope === "local-domain") {
    const domain = store.domains.find((item) => item.id === view.selectedDomainId);
    if (!domain || !localWorkMutable() || domain.status === "archived") return;
    const expectedVersion = domain.version;
    if (field === "owners") domain.owners = input.value.split(",").map((item) => item.trim()).filter(Boolean);
    else (domain as unknown as Record<string, unknown>)[field] = raw;
    touchScope(domain);
    render();
    persistStructuredItem("domain", domain, expectedVersion);
    return;
  } else if (scope === "local-milestone") {
    const milestone = store.milestones.find((item) => item.id === view.selectedMilestoneId);
    if (!milestone || !localWorkMutable() || milestone.status === "archived") return;
    const expectedVersion = milestone.version;
    if (field === "domainId") {
      if (!domainFor(input.value)) return;
      const hasWork = store.tasks.some((item) => item.milestoneId === milestone.id) || store.todos.some((item) => item.milestoneId === milestone.id);
      if (hasWork && input.value !== milestone.domainId) { toast("연결된 Task·Todo가 있는 Milestone은 Domain을 바꿀 수 없습니다."); render(); return; }
      milestone.domainId = input.value;
    } else if (field === "owners") milestone.owners = input.value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (field === "successCriteria") milestone.successCriteria = input.value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
    else if (field === "dueDate") { if (input.value) milestone.dueDate = input.value; else delete milestone.dueDate; }
    else (milestone as unknown as Record<string, unknown>)[field] = raw;
    touchScope(milestone);
    render();
    persistStructuredItem("milestone", milestone, expectedVersion);
    return;
  } else if (scope === "graph") {
    const mutable = graph as unknown as Record<string, unknown>;
    mutable[field] = input.type === "number" ? (input.value ? Number(input.value) : undefined) : raw;
  } else if (scope === "graph-routing") {
    if (raw) (graph.defaults as Record<string, unknown>)[field] = raw;
    else delete (graph.defaults as Record<string, unknown>)[field];
  } else if (scope === "guard") {
    if (input.value) (graph.runGuards as unknown as Record<string, unknown>)[field] = Number(input.value);
    else delete (graph.runGuards as unknown as Record<string, unknown>)[field];
  } else if (scope === "graph-engineering") {
    graph.engineering ??= {};
    const mutable = graph.engineering as unknown as Record<string, unknown>;
    if (["globalBudgetTokens", "reservedVerificationTokens", "maxParallelism", "traversalHopLimit"].includes(field)) {
      if (input.value) mutable[field] = Number(input.value); else delete mutable[field];
    } else if (field === "competencyQuestions") {
      mutable[field] = input.value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    } else if (input instanceof HTMLInputElement && input.type === "checkbox") {
      mutable[field] = input.checked;
    } else if (raw) mutable[field] = raw;
    else delete mutable[field];
  } else if (scope === "graph-editor") {
    const editor = editorPolicy(graph) as unknown as Record<string, unknown>;
    if (raw) editor[field] = raw;
    else delete editor[field];
  } else if (scope === "node" && node) {
    const mutable = node as unknown as Record<string, unknown>;
    mutable[field] = raw;
    if (field === "kind") {
      if (raw === "task" && !node.task) node.task = { id: newId("task"), title: node.label || "새 Task", prompt: "수행할 작업을 입력하십시오." };
      if (raw === "task" && localWorkMutable()) {
        const task = upsertLocalTask(node.task);
        if (task) view.selectedTaskId = task.id;
      }
      if (raw === "condition" && !node.conditionExpr) node.conditionExpr = "판정할 조건을 입력하십시오.";
      if (raw === "graph_call") {
        node.graphCallRoutingMode ??= "child";
        node.graphCallFailureMode ??= "fail_parent";
      }
    }
  } else if (scope === "task" && node?.task) {
    if (raw) (node.task as unknown as Record<string, unknown>)[field] = raw;
    else delete (node.task as unknown as Record<string, unknown>)[field];
    if (localWorkMutable()) {
      const task = upsertLocalTask(node.task);
      if (task) syncTaskToGraphNodes(task);
      touch(graph);
      recordGraphHistory(beforeGraph, "Task 데이터 변경", graph);
      render();
      return;
    }
  } else if (scope === "node-routing" && node) {
    node.routing ??= {};
    if (raw) (node.routing as unknown as Record<string, unknown>)[field] = raw;
    else delete (node.routing as unknown as Record<string, unknown>)[field];
  } else if (scope === "node-engineering" && node) {
    node.engineering ??= {};
    const mutable = node.engineering as unknown as Record<string, unknown>;
    if (["maxAttempts", "timeoutSeconds", "budgetTokens"].includes(field)) {
      if (input.value) mutable[field] = Number(input.value); else delete mutable[field];
    } else if (field === "reads" || field === "writes") {
      mutable[field] = input.value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean);
    } else if (input instanceof HTMLInputElement && input.type === "checkbox") {
      mutable[field] = input.checked;
    } else if (raw) mutable[field] = raw;
    else delete mutable[field];
  } else if (scope === "node-permission" && node) {
    node.engineering ??= {};
    const permissions = new Set(node.engineering.permissions ?? []);
    const permission = field as "read" | "write" | "network" | "exec";
    if (raw) permissions.add(permission); else permissions.delete(permission);
    node.engineering.permissions = [...permissions];
  } else if (scope === "multi-node-routing") {
    const nodes = selectedNodes(graph);
    if (!nodes.length) return;
    for (const selected of nodes) {
      selected.routing ??= {};
      if (raw) (selected.routing as unknown as Record<string, unknown>)[field] = raw;
      else delete (selected.routing as unknown as Record<string, unknown>)[field];
    }
  } else if (scope === "multi-node-engineering") {
    if (!raw) return;
    for (const selected of selectedNodes(graph)) {
      selected.engineering ??= {};
      (selected.engineering as unknown as Record<string, unknown>)[field] = raw;
    }
  } else if (scope === "edge" && edge) {
    const source = graph.nodes.find((candidate) => candidate.id === edge.from);
    if ((field === "kind" && raw === "loop" && source?.kind !== "condition")
      || (field === "branch" && raw && source?.kind !== "condition")) {
      toast("Loop와 분기 라벨은 조건 노드에서 시작하는 연결에만 사용할 수 있습니다.");
      render();
      return;
    }
    if (raw) (edge as unknown as Record<string, unknown>)[field] = raw;
    else delete (edge as unknown as Record<string, unknown>)[field];
    if (field === "kind" && raw === "loop" && !edge.branch) edge.branch = "n";
    if (field === "kind" && raw !== "loop" && source?.kind !== "condition") delete edge.branch;
  } else if (scope === "edge-endpoint" && edge) {
    const nextFrom = field === "from" ? input.value : edge.from;
    const nextTo = field === "to" ? input.value : edge.to;
    const endpointsExist = graph.nodes.some((candidate) => candidate.id === nextFrom)
      && graph.nodes.some((candidate) => candidate.id === nextTo);
    const duplicate = graph.edges.some((candidate) => candidate.id !== edge.id && candidate.from === nextFrom && candidate.to === nextTo);
    const nextSource = graph.nodes.find((candidate) => candidate.id === nextFrom);
    const invalidLoopSource = edge.kind === "loop" && nextSource?.kind !== "condition";
    if (!endpointsExist || nextFrom === nextTo || duplicate || invalidLoopSource || (edge.kind !== "loop" && wouldCreateCycle(graph, nextFrom, nextTo, edge.id))) {
      const message = duplicate
        ? "같은 노드 사이의 연결이 이미 있습니다."
        : invalidLoopSource
          ? "Loop 연결은 조건 노드에서 시작해야 합니다."
          : nextFrom === nextTo
            ? "노드는 자기 자신에 연결할 수 없습니다."
            : "일반 연결은 순환을 만들 수 없습니다. Loop 연결을 사용하십시오.";
      toast(message);
      render();
      return;
    }
    edge.from = nextFrom;
    edge.to = nextTo;
    if (nextSource?.kind !== "condition") delete edge.branch;
    if (graph.engineering?.editor?.edgeWaypoints?.[edge.id]) delete graph.engineering.editor.edgeWaypoints[edge.id];
  }
  touch(graph);
  recordGraphHistory(beforeGraph, "그래프 속성 변경", graph);
  render();
});

app.addEventListener("change", (event) => {
  const sourceMode = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-source-field="mode"]');
  if (sourceMode && view.modal?.kind === "data-source") {
    dataSource = { ...dataSource, config: sourceConfigFromForm() };
    render();
    return;
  }
  const archived = (event.target as HTMLElement).closest<HTMLInputElement>('[data-action="include-archived"]');
  if (archived) {
    view.includeArchived = archived.checked;
    render();
    return;
  }
  const control = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-action]");
  if (!control) return;
  switch (control.dataset.action) {
    case "graph-status-filter": view.graphStatusFilter = control.value as ViewState["graphStatusFilter"]; render(); break;
    case "graph-run-filter": view.graphRunFilter = control.value as ViewState["graphRunFilter"]; render(); break;
    case "graph-sort": view.graphSort = control.value as ViewState["graphSort"]; render(); break;
    case "task-status-filter": view.taskStatusFilter = control.value as ViewState["taskStatusFilter"]; view.selectedTaskId = null; render(); break;
    case "todo-status-filter": view.todoStatusFilter = control.value as ViewState["todoStatusFilter"]; view.selectedTodoId = null; render(); break;
    case "work-domain-filter":
      view.workDomainFilter = control.value;
      view.workMilestoneFilter = "all";
      view.selectedTaskId = null; view.selectedTodoId = null; render(); break;
    case "work-milestone-filter": view.workMilestoneFilter = control.value; view.selectedTaskId = null; view.selectedTodoId = null; render(); break;
    case "work-group":
      if (view.mode === "tasks") view.taskWorkGroup = control.value as WorkGroupMode;
      else if (view.mode === "todos") view.todoWorkGroup = control.value as WorkGroupMode;
      render();
      break;
    case "work-sort": view.workSort = control.value as ViewState["workSort"]; render(); break;
    case "group-mode": {
      if (view.editorMode !== "design") { toast("캔버스 그룹은 설계 모드에서 바꿀 수 있습니다."); render(); break; }
      const graph = activeGraph();
      const before = graphSnapshot(graph);
      editorPolicy(graph).groupBy = control.value as GraphGroupMode;
      touch(graph); recordGraphHistory(before, "캔버스 그룹 변경", graph); render(); break;
    }
  }
});

app.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-action="graph-search"], [data-action="work-search"], [data-action="scope-search"], [data-action="node-search"]');
  if (!input || (event as InputEvent).isComposing) return;
  const workSearch = input.dataset.action === "work-search";
  const scopeSearch = input.dataset.action === "scope-search";
  const nodeSearch = input.dataset.action === "node-search";
  if (workSearch) view.workQuery = input.value;
  else if (scopeSearch) view.scopeQuery = input.value;
  else if (nodeSearch) view.nodeQuery = input.value;
  else view.graphQuery = input.value;
  const start = input.selectionStart;
  render();
  const next = app.querySelector<HTMLInputElement>(workSearch ? '[data-action="work-search"]' : scopeSearch ? '[data-action="scope-search"]' : nodeSearch ? '[data-action="node-search"]' : '[data-action="graph-search"]');
  next?.focus();
  if (start !== null) next?.setSelectionRange(start, start);
});

app.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-action="switch-graph"]');
  if (!select) return;
  store.activeGraphId = select.value;
  view.graphTrail = []; clearGraphSelection(); render();
  window.setTimeout(fitGraph, 0);
});

let narrowViewport = window.innerWidth <= 760;
window.addEventListener("resize", () => {
  const nextNarrow = window.innerWidth <= 760;
  if (isWideMode && narrowViewport && !nextNarrow) view.inspectorOpen = true;
  narrowViewport = nextNarrow;
  render();
  if (view.mode === "canvas") window.setTimeout(fitGraph, 0);
});

function snapNodeToAlignmentGuides(node: GraphNode, x: number, y: number, excluded = new Set<string>()): { x: number; y: number; guides: { x?: number; y?: number } } {
  const size = nodeSize(node);
  const threshold = 7 / view.zoom;
  let bestX: { distance: number; delta: number; guide: number } | undefined;
  let bestY: { distance: number; delta: number; guide: number } | undefined;
  const movingX = [x, x + size.width / 2, x + size.width];
  const movingY = [y, y + size.height / 2, y + size.height];
  for (const other of activeGraph().nodes) {
    if (other.id === node.id || excluded.has(other.id)) continue;
    const otherSize = nodeSize(other);
    const targetX = [other.x, other.x + otherSize.width / 2, other.x + otherSize.width];
    const targetY = [other.y, other.y + otherSize.height / 2, other.y + otherSize.height];
    for (const source of movingX) for (const target of targetX) {
      const delta = target - source;
      const distance = Math.abs(delta);
      if (distance <= threshold && (!bestX || distance < bestX.distance)) bestX = { distance, delta, guide: target };
    }
    for (const source of movingY) for (const target of targetY) {
      const delta = target - source;
      const distance = Math.abs(delta);
      if (distance <= threshold && (!bestY || distance < bestY.distance)) bestY = { distance, delta, guide: target };
    }
  }
  return {
    x: x + (bestX?.delta ?? 0),
    y: y + (bestY?.delta ?? 0),
    guides: {
      ...(bestX ? { x: bestX.guide } : {}),
      ...(bestY ? { y: bestY.guide } : {}),
    },
  };
}

type DragState =
  | { type: "node"; primaryId: string; ids: string[]; origins: Map<string, Point>; startX: number; startY: number; before: GraphDefinition; moved: boolean }
  | { type: "pan"; startX: number; startY: number; originX: number; originY: number }
  | { type: "selection"; additive: boolean }
  | { type: "connection"; fromNodeId: string; fromSide: NodeSide; start: Point; targetNodeId: string | null; targetValid: boolean; pointer: Point }
  | { type: "bend"; edgeId: string; index: number; before: GraphDefinition; moved: boolean };

let drag: DragState | null = null;

function pointInCanvas(clientX: number, clientY: number): Point | null {
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function pointInWorld(clientX: number, clientY: number): Point | null {
  const point = pointInCanvas(clientX, clientY);
  return point ? { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom } : null;
}

function paintViewport(): void {
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  const world = app.querySelector<HTMLElement>(".world");
  if (!canvas || !world) return;
  world.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`;
  const minorWorldStep = view.zoom < .5 ? GRID * 4 : view.zoom < .8 ? GRID * 2 : GRID;
  const minorStep = minorWorldStep * view.zoom;
  const majorStep = GRID * 5 * view.zoom;
  const offset = (value: number, step: number) => ((value % step) + step) % step;
  canvas.style.setProperty("--grid-minor", `${minorStep}px`);
  canvas.style.setProperty("--grid-major", `${majorStep}px`);
  canvas.style.setProperty("--grid-minor-x", `${offset(view.panX, minorStep)}px`);
  canvas.style.setProperty("--grid-minor-y", `${offset(view.panY, minorStep)}px`);
  canvas.style.setProperty("--grid-major-x", `${offset(view.panX, majorStep)}px`);
  canvas.style.setProperty("--grid-major-y", `${offset(view.panY, majorStep)}px`);
  canvas.classList.remove("zoom-detail", "zoom-compact", "zoom-overview");
  canvas.classList.add(`zoom-${semanticZoomLevel()}`);
  const readout = app.querySelector<HTMLElement>(".zoom-readout");
  if (readout) readout.textContent = `${Math.round(view.zoom * 100)}%`;
  const viewport = app.querySelector<SVGRectElement>(".mini-viewport");
  if (viewport) {
    viewport.setAttribute("x", String(-view.panX / view.zoom));
    viewport.setAttribute("y", String(-view.panY / view.zoom));
    viewport.setAttribute("width", String(canvas.clientWidth / view.zoom));
    viewport.setAttribute("height", String(canvas.clientHeight / view.zoom));
  }
}

function paintGraphMotion(): void {
  const graph = activeGraph();
  for (const node of graph.nodes) {
    const element = app.querySelector<HTMLElement>(`.node[data-node-id="${selectorEscape(node.id)}"]`);
    if (element) { element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; }
  }
  for (const edge of graph.edges) {
    const geometry = edgePath(edge, graph);
    const group = app.querySelector<SVGGElement>(`g[data-edge-id="${selectorEscape(edge.id)}"]`);
    if (!geometry || !group) continue;
    group.querySelectorAll<SVGPathElement>(".edge-hit, .edge-halo, .edge").forEach((path) => path.setAttribute("d", geometry.d));
    group.querySelector<SVGGElement>(".edge-label-badge")?.setAttribute("transform", `translate(${geometry.labelX} ${geometry.labelY})`);
    (graph.engineering?.editor?.edgeWaypoints?.[edge.id] ?? []).forEach((point, index) => {
      const handle = group.querySelector<SVGCircleElement>(`[data-edge-bend="${index}"]`);
      handle?.setAttribute("cx", String(point.x)); handle?.setAttribute("cy", String(point.y));
    });
  }
  const xGuide = app.querySelector<SVGLineElement>('[data-alignment-guide="x"]');
  const yGuide = app.querySelector<SVGLineElement>('[data-alignment-guide="y"]');
  if (xGuide) {
    if (view.alignmentGuides.x === undefined) xGuide.setAttribute("hidden", ""); else xGuide.removeAttribute("hidden");
    if (view.alignmentGuides.x !== undefined) { xGuide.setAttribute("x1", String(view.alignmentGuides.x)); xGuide.setAttribute("x2", String(view.alignmentGuides.x)); }
  }
  if (yGuide) {
    if (view.alignmentGuides.y === undefined) yGuide.setAttribute("hidden", ""); else yGuide.removeAttribute("hidden");
    if (view.alignmentGuides.y !== undefined) { yGuide.setAttribute("y1", String(view.alignmentGuides.y)); yGuide.setAttribute("y2", String(view.alignmentGuides.y)); }
  }
}

function connectionPreviewPath(start: Point, end: Point, side: NodeSide): string {
  const horizontal = side === "left" || side === "right";
  const points = horizontal
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
  return roundedOrthogonalPath(points);
}

function wouldCreateCycle(graph: GraphDefinition, from: string, to: string, ignoredEdgeId?: string): boolean {
  const queue = [to];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...graph.edges.filter((edge) => edge.id !== ignoredEdgeId && edge.kind !== "loop" && edge.from === id).map((edge) => edge.to));
  }
  return false;
}

function connectionTarget(point: Point, fromNodeId: string): { nodeId: string; valid: boolean } | null {
  const graph = activeGraph();
  const node = graph.nodes.find((candidate) => {
    if (candidate.id === fromNodeId) return false;
    const size = nodeSize(candidate);
    return point.x >= candidate.x - 14 && point.x <= candidate.x + size.width + 14 && point.y >= candidate.y - 14 && point.y <= candidate.y + size.height + 14;
  });
  return node ? { nodeId: node.id, valid: !wouldCreateCycle(graph, fromNodeId, node.id) } : null;
}

function paintConnection(state: Extract<DragState, { type: "connection" }>): void {
  const preview = app.querySelector<SVGPathElement>("[data-connection-preview]");
  if (preview) {
    preview.removeAttribute("hidden");
    preview.setAttribute("d", connectionPreviewPath(state.start, state.pointer, state.fromSide));
    preview.classList.toggle("invalid", Boolean(state.targetNodeId && !state.targetValid));
  }
  app.querySelectorAll<HTMLElement>(".node.connecting-target, .node.invalid-target").forEach((node) => node.classList.remove("connecting-target", "invalid-target"));
  if (state.targetNodeId) {
    const target = app.querySelector<HTMLElement>(`.node[data-node-id="${selectorEscape(state.targetNodeId)}"]`);
    target?.classList.add(state.targetValid ? "connecting-target" : "invalid-target");
  }
}

function paintSelectionBox(): void {
  const box = view.selectionBox;
  const element = app.querySelector<HTMLElement>(".selection-box");
  if (!box || !element) return;
  element.style.left = `${Math.min(box.startX, box.x)}px`;
  element.style.top = `${Math.min(box.startY, box.y)}px`;
  element.style.width = `${Math.abs(box.x - box.startX)}px`;
  element.style.height = `${Math.abs(box.y - box.startY)}px`;
}

app.addEventListener("pointerdown", (event) => {
  const target = event.target as Element;
  const bend = target.closest<SVGCircleElement>("[data-edge-bend]");
  if (bend?.dataset.edgeId && bend.dataset.edgeBend !== undefined && view.editorMode === "design") {
    drag = { type: "bend", edgeId: bend.dataset.edgeId, index: Number(bend.dataset.edgeBend), before: graphSnapshot(), moved: false };
    event.preventDefault(); return;
  }
  const port = target.closest<HTMLElement>("[data-connect-port]");
  if (port?.dataset.nodeId && port.dataset.side && view.editorMode === "design") {
    const node = activeGraph().nodes.find((item) => item.id === port.dataset.nodeId);
    if (!node) return;
    const side = port.dataset.side as NodeSide;
    const start = pointForSide(node, side);
    view.connectingFrom = node.id;
    view.connectionPointer = start;
    drag = { type: "connection", fromNodeId: node.id, fromSide: side, start, targetNodeId: null, targetValid: false, pointer: start };
    render();
    const current = drag;
    if (current?.type === "connection") paintConnection(current);
    event.preventDefault(); return;
  }
  const nodeHandle = target.closest<HTMLElement>("[data-drag-node]");
  if (nodeHandle?.dataset.dragNode && view.editorMode === "design" && !target.closest("button, input, textarea, select")) {
    const graph = activeGraph();
    const node = graph.nodes.find((item) => item.id === nodeHandle.dataset.dragNode);
    if (!node) return;
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    if (additive) {
      const ids = new Set(view.selectedNodeIds);
      if (!ids.has(node.id)) ids.add(node.id);
      setNodeSelection([...ids], node.id);
    } else if (!view.selectedNodeIds.includes(node.id)) setNodeSelection([node.id], node.id);
    else view.selectedNodeId = node.id;
    view.inspectorOpen = true;
    if (!additive) view.inspectorTab = "task";
    const ids = view.selectedNodeIds.length ? [...view.selectedNodeIds] : [node.id];
    const origins = new Map(graph.nodes.filter((item) => ids.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }]));
    view.alignmentGuides = {};
    drag = { type: "node", primaryId: node.id, ids, origins, startX: event.clientX, startY: event.clientY, before: graphSnapshot(graph), moved: false };
    event.preventDefault(); return;
  }
  const canvas = target.closest<HTMLElement>("[data-canvas]");
  if (canvas && !target.closest(".node, .canvas-hud, .minimap, .problems-panel, .layout-preview-bar, .quick-create")) {
    const point = pointInCanvas(event.clientX, event.clientY);
    if (!point) return;
    if (event.shiftKey) {
      view.selectionBox = { startX: point.x, startY: point.y, x: point.x, y: point.y, additive: event.metaKey || event.ctrlKey };
      drag = { type: "selection", additive: event.metaKey || event.ctrlKey };
      render();
    } else {
      if (!event.metaKey && !event.ctrlKey) clearGraphSelection();
      drag = { type: "pan", startX: event.clientX, startY: event.clientY, originX: view.panX, originY: view.panY };
    }
    event.preventDefault();
  }
});

window.addEventListener("pointermove", (event) => {
  if (!drag) return;
  if (drag.type === "pan") {
    view.panX = drag.originX + event.clientX - drag.startX;
    view.panY = drag.originY + event.clientY - drag.startY;
    paintViewport();
  } else if (drag.type === "selection") {
    const point = pointInCanvas(event.clientX, event.clientY);
    if (point && view.selectionBox) { view.selectionBox.x = point.x; view.selectionBox.y = point.y; paintSelectionBox(); }
  } else if (drag.type === "connection") {
    const point = pointInWorld(event.clientX, event.clientY);
    if (!point) return;
    drag.pointer = point;
    view.connectionPointer = point;
    const target = connectionTarget(point, drag.fromNodeId);
    drag.targetNodeId = target?.nodeId ?? null;
    drag.targetValid = target?.valid ?? false;
    paintConnection(drag);
  } else if (drag.type === "bend") {
    const point = pointInWorld(event.clientX, event.clientY);
    const waypoint = activeGraph().engineering?.editor?.edgeWaypoints?.[drag.edgeId]?.[drag.index];
    if (point && waypoint) {
      waypoint.x = Math.round(point.x / GRID) * GRID;
      waypoint.y = Math.round(point.y / GRID) * GRID;
      drag.moved = true; view.dirty = true; paintGraphMotion();
    }
  } else {
    const graph = activeGraph();
    const nodeDrag = drag;
    const primary = graph.nodes.find((node) => node.id === nodeDrag.primaryId);
    const origin = nodeDrag.origins.get(nodeDrag.primaryId);
    if (!primary || !origin) return;
    const gridX = Math.round((origin.x + (event.clientX - nodeDrag.startX) / view.zoom) / GRID) * GRID;
    const gridY = Math.round((origin.y + (event.clientY - nodeDrag.startY) / view.zoom) / GRID) * GRID;
    const excluded = new Set(nodeDrag.ids);
    const snapped = snapNodeToAlignmentGuides(primary, gridX, gridY, excluded);
    const deltaX = snapped.x - origin.x;
    const deltaY = snapped.y - origin.y;
    for (const id of nodeDrag.ids) {
      const node = graph.nodes.find((item) => item.id === id);
      const start = nodeDrag.origins.get(id);
      if (node && start) { node.x = start.x + deltaX; node.y = start.y + deltaY; }
    }
    nodeDrag.moved ||= deltaX !== 0 || deltaY !== 0;
    view.alignmentGuides = snapped.guides;
    view.dirty = true;
    paintGraphMotion();
  }
});

window.addEventListener("pointerup", () => {
  const ended = drag;
  drag = null;
  if (!ended) return;
  if (ended.type === "node" && ended.moved) {
    touch(activeGraph()); recordGraphHistory(ended.before, `노드 ${ended.ids.length}개 이동`);
    suppressNextClick = true;
  } else if (ended.type === "bend" && ended.moved) {
    touch(activeGraph()); recordGraphHistory(ended.before, "연결 꺾임점 이동");
    suppressNextClick = true;
  } else if (ended.type === "selection" && view.selectionBox) {
    const canvas = app.querySelector<HTMLElement>("[data-canvas]");
    if (canvas) {
      const box = view.selectionBox;
      const left = (Math.min(box.startX, box.x) - view.panX) / view.zoom;
      const right = (Math.max(box.startX, box.x) - view.panX) / view.zoom;
      const top = (Math.min(box.startY, box.y) - view.panY) / view.zoom;
      const bottom = (Math.max(box.startY, box.y) - view.panY) / view.zoom;
      const ids = activeGraph().nodes.filter((node) => {
        const size = nodeSize(node);
        return node.x + size.width >= left && node.x <= right && node.y + size.height >= top && node.y <= bottom;
      }).map((node) => node.id);
      setNodeSelection(ended.additive ? [...view.selectedNodeIds, ...ids] : ids);
    }
  } else if (ended.type === "connection") {
    suppressNextClick = true;
    if (ended.targetNodeId && ended.targetValid) {
      view.connectingFrom = ended.fromNodeId;
      connectTo(ended.targetNodeId);
      return;
    }
    if (ended.targetNodeId && !ended.targetValid) toast("이 연결은 비-loop 순환을 만들기 때문에 추가할 수 없습니다.");
    else view.quickCreate = { x: ended.pointer.x, y: ended.pointer.y, fromNodeId: ended.fromNodeId };
  }
  view.alignmentGuides = {};
  view.selectionBox = null;
  view.connectionPointer = null;
  render();
});

app.addEventListener("contextmenu", (event) => {
  const target = event.target as Element;
  if (view.editorMode !== "design" || !target.closest("[data-canvas]") || target.closest(".node, .canvas-hud, .minimap, .problems-panel")) return;
  const point = pointInWorld(event.clientX, event.clientY);
  if (!point) return;
  event.preventDefault();
  view.quickCreate = { x: point.x, y: point.y };
  render();
});

app.addEventListener("wheel", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest("[data-canvas]") || target.closest(".inspector, .problems-panel")) return;
  event.preventDefault();
  const canvas = target.closest<HTMLElement>("[data-canvas]");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const oldZoom = view.zoom;
  const nextZoom = Math.max(.25, Math.min(1.8, oldZoom * (event.deltaY > 0 ? .9 : 1.1)));
  view.panX = mouseX - ((mouseX - view.panX) / oldZoom) * nextZoom;
  view.panY = mouseY - ((mouseY - view.panY) / oldZoom) * nextZoom;
  view.zoom = nextZoom;
  paintViewport();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (view.modal) {
    const dialog = app.querySelector<HTMLElement>('[role="dialog"]');
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key === "Tab" && dialog) {
      const focusables = focusableElements(dialog);
      if (!focusables.length) {
        event.preventDefault();
        dialog.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? focusables.at(-1) : focusables[0])?.focus();
      } else if (event.shiftKey && document.activeElement === focusables[0]) {
        event.preventDefault();
        focusables.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === focusables.at(-1)) {
        event.preventDefault();
        focusables[0]?.focus();
      }
    }
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "k") {
    event.preventDefault();
    const input = app.querySelector<HTMLInputElement>('[data-action="node-search"]');
    input?.focus(); input?.select();
    return;
  }
  if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (event.key === "Escape") {
    clearGraphSelection(); view.selectionBox = null; view.quickCreate = null; render();
  }
  if ((event.key === "Delete" || event.key === "Backspace") && view.editorMode === "design") {
    if (view.selectedNodeIds.length || view.selectedNodeId) removeSelectedNode();
    else if (view.selectedEdgeId) removeSelectedEdge();
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveStore().catch((error) => toast(error instanceof Error ? error.message : String(error)));
  }
  if (command && event.key.toLowerCase() === "z" && view.editorMode === "design") {
    event.preventDefault();
    if (event.shiftKey) redoGraphChange(); else undoGraphChange();
  }
  if (command && event.key.toLowerCase() === "c" && view.editorMode === "design") { event.preventDefault(); copySelection(); }
  if (command && event.key.toLowerCase() === "v" && view.editorMode === "design") { event.preventDefault(); pasteSelection(); }
  if (command && event.key.toLowerCase() === "d" && view.editorMode === "design") { event.preventDefault(); duplicateSelection(); }
  if (command && event.key.toLowerCase() === "a" && view.mode === "canvas") {
    event.preventDefault(); setNodeSelection(activeGraph().nodes.map((node) => node.id)); view.inspectorOpen = true; render();
  }
  if (event.key === "0") { event.preventDefault(); fitGraph(); }
  if (event.key === "+" || event.key === "=") { event.preventDefault(); view.zoom = Math.min(1.8, view.zoom + .1); paintViewport(); }
  if (event.key === "-") { event.preventDefault(); view.zoom = Math.max(.25, view.zoom - .1); paintViewport(); }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && view.selectedNodeIds.length && view.editorMode === "design") {
    event.preventDefault();
    const graph = activeGraph();
    const before = graphSnapshot(graph);
    const step = event.shiftKey ? GRID * 4 : GRID;
    for (const node of selectedNodes(graph)) {
      if (event.key === "ArrowLeft") node.x -= step;
      if (event.key === "ArrowRight") node.x += step;
      if (event.key === "ArrowUp") node.y -= step;
      if (event.key === "ArrowDown") node.y += step;
    }
    touch(graph); recordGraphHistory(before, "선택 노드 키보드 이동", graph); render();
  }
});

render();
const initialCanvas = app.querySelector<HTMLElement>("[data-canvas]");
if (initialCanvas) {
  const initialFitObserver = new ResizeObserver(() => {
    if (initialCanvas.clientWidth < 120 || initialCanvas.clientHeight < 120) return;
    initialFitObserver.disconnect();
    fitGraph();
  });
  initialFitObserver.observe(initialCanvas);
}
