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
  type GraphRunRecord,
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
  type PanelView,
  normalizePanelView,
  type NodeObservation,
  type ProjectTarget,
  type SessionTarget,
  type BranchTarget,
  type EnvironmentTarget,
  type RoutingTarget,
  DISPATCH_LOG_LIMIT,
  type DispatchRecord,
  type DispatchTarget,
  type ExecutionItemKind,
  type ExecutionMode,
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
  executionMode: ExecutionMode;
  selectedProjectIds: string[];
  projectRoutings: Record<string, RoutingTarget>;
  nodeRouting: Record<string, RoutingTarget>;
  conditionBranches: Record<string, string>;
  inputPrompt: string;
  startNewRun: boolean;
  autoApprove: boolean;
  suggestedProjectId?: string;
  inferredProjectNodeIds?: string[];
  busy?: boolean;
  saving?: boolean;
  error?: string;
  errorAction?: "save" | "run";
};

type TaskRunModalState = {
  kind: "task-run";
  itemKind: "task" | "todo";
  itemId: string;
  routing: RoutingTarget;
  executionMode: ExecutionMode;
  selectedProjectIds: string[];
  projectRoutings: Record<string, RoutingTarget>;
  autoApprove: boolean;
  suggestedProjectId?: string;
  busy?: boolean;
  saving?: boolean;
  error?: string;
  errorAction?: "save" | "run";
};

type SavedTaskRunSettings = {
  schemaVersion: 1;
  routing: RoutingTarget;
  executionMode: ExecutionMode;
  selectedProjectIds: string[];
  projectRoutings: Record<string, RoutingTarget>;
  autoApprove?: boolean;
  savedAt: string;
};

const taskRunSettingsMetadataKey = "orcaGraphRunSettings";

type RunProjectReference = { locator: string; label?: string; branch?: string };
type RunProjectCandidate = {
  project: ProjectTarget;
  locator: string;
  label: string;
  branch?: string;
  saved: boolean;
};

type TodoGraphChoice = { id: string; name: string; status: string };

type ModalState =
  | { kind: "data-source"; error?: string }
  | RunModalState
  | TaskRunModalState
  | { kind: "quick-graph"; sourceTaskId: string; name: string; query: string; selectedIds: string[]; busy: boolean; error?: string }
  | { kind: "todo-graph-picker"; todoId: string; taskId: string; taskTitle: string; graphs: TodoGraphChoice[] }
  | { kind: "task-delete"; taskId: string }
  | { kind: "dispatch-detail"; recordId: string }
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
  mode: "canvas" | "list" | "executions" | "domains" | "milestones" | "tasks" | "todos";
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
  /** 실행 이력을 펼쳐 둔 항목. `kind:id` 형태다. */
  expandedExecutionItems: Set<string>;
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
const workspaceProductName = `${["under", "joy"].join("")}-workspace`;

// Orca는 패널 문서를 `sandbox="allow-scripts"` iframe에 `connect-src 'none'` CSP로
// 감싼다. 네트워크도 파일도 브라우저 저장소도 없고 플러그인 워커와 통신할 채널도
// 없으므로, 패널이 밖으로 나가는 유일한 통로는 `terminal.sendText`다. 조회는
// panel.html의 bootstrap JSON으로 들어오고, 저장과 실행은 그 통로로 나간다.
let store: GraphStore = normalizeGraphStore(bootstrap.store);

const CHANGE_COLLECTIONS = ["graphs", "domains", "milestones", "tasks", "todos"] as const;
type ChangeCollection = (typeof CHANGE_COLLECTIONS)[number];

/**
 * 마지막으로 원천과 일치했던 상태. 저장에 성공하면 여기가 새 기준이 된다.
 *
 * 부팅 시점의 store가 곧 원천의 상태이므로 그때 바로 기준을 잡는다. 비워 두면
 * 첫 저장이 store 전체를 보내게 되고, 실제 데이터에서는 그것이 터미널 한 줄에
 * 담기지 않는다.
 */
let savedBaseline = new Map<string, string>();

function baselineKey(collection: ChangeCollection, id: string): string {
  return `${collection}:${id}`;
}

function captureBaseline(source: GraphStore): Map<string, string> {
  const baseline = new Map<string, string>();
  for (const collection of CHANGE_COLLECTIONS) {
    for (const item of source[collection]) baseline.set(baselineKey(collection, item.id), JSON.stringify(item));
  }
  return baseline;
}

function resetBaseline(): void {
  savedBaseline = captureBaseline(store);
}

// 부팅 시점의 store가 원천의 상태다. 여기서 기준을 잡아야 첫 저장이 바뀐 것만 보낸다.
resetBaseline();

let targets = bootstrap.targets;
let dataSource: DataSourceState = bootstrap.dataSource ?? {
  config: { schemaVersion: 1, mode: "local" },
  status: "idle",
  catalog: [],
  message: "로컬 JSON 저장소를 사용합니다.",
};
/** 현재 Orca worktree 이름. 실행 대상 프로젝트를 추천할 때만 쓰는 힌트다. */
let currentWorkspaceName = "";
let taskProjectPickerEnvironment = "";
let taskProjectPickerQuery = "";
const selectedTaskProjectBundles = new Map<string, string>();
const todoTaskCreationKeys = new Map<string, { signature: string; key: string }>();
const busyTodoActions = new Set<string>();
if (!store.graphs.length) {
  const now = new Date().toISOString();
  const id = newId("graph");
  store.graphs.push({
    id, name: "새 그래프", summary: "", status: "draft",
    version: dataSource.config.mode === "structured" ? 0 : 1,
    pinned: false, processEnabled: false, routineEnabled: false, repeatMode: "none", defaults: {},
    runGuards: { claimLeaseSeconds: 21600, stagnationRuns: 3 },
    engineering: { checkpointPolicy: "superstep", requireProvenance: true, humanGateForIrreversible: true, maturity: "experimental" },
    nodes: [], edges: [], runs: [], createdAt: now, updatedAt: now,
  });
  store.activeGraphId = id;
}
const restoredPanelView = normalizePanelView(bootstrap.store?.panelView);
const view: ViewState = {
  mode: restoredPanelView?.mode ?? "canvas",
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
  expandedExecutionItems: new Set(),
  workSort: "updated-desc",
  scopeQuery: "",
  nodeQuery: "",
  selectedDomainId: null,
  selectedMilestoneId: null,
  selectedTaskId: restoredPanelView?.selectedTaskId ?? null,
  selectedTodoId: restoredPanelView?.selectedTodoId ?? null,
  taskDetailOpen: Boolean(restoredPanelView?.taskDetailOpen),
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

/**
 * 사람이 직접 고친 Meta Draft를 현재 Meta revision으로 append한다.
 *
 * Meta는 실행에 실제로 쓰이는 프롬프트다. revision 없이 필드만 바꾸면 무엇을 근거로
 * 그 프롬프트가 됐는지가 이력에서 사라진다.
 */
function setMetaDraft(item: LocalTask | LocalTodo, content: string): boolean {
  const trimmed = content.trim();
  if ((item.metaDraft ?? "") === content) return false;
  const basedOn = currentDraftRevision(item);
  for (const revision of item.promptRevisions) {
    if (revision.kind === "meta") revision.status = "stale";
  }
  if (trimmed) {
    item.promptRevisions.push({
      id: `${item.id}:meta:${crypto.randomUUID()}`,
      kind: "meta",
      revision: nextPromptRevision(item),
      content,
      status: "current",
      generator: "human",
      ...(basedOn ? { basedOnId: basedOn.id } : {}),
      createdAt: new Date().toISOString(),
    });
    item.metaDraft = content;
    if ("prompt" in item) item.prompt = content;
  } else {
    delete item.metaDraft;
    if ("prompt" in item) item.prompt = item.draft;
  }
  touchWorkItem(item);
  return true;
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
  patchToast();
  window.setTimeout(() => {
    if (view.toast === message) {
      view.toast = "";
      patchToast();
    }
  }, 2600);
}

function toastMarkup(): string {
  return view.toast ? `<div class="toast" role="status" aria-live="polite" aria-atomic="true">${esc(view.toast)}</div>` : "";
}

function patchToast(): void {
  app.querySelector(".toast")?.remove();
  if (!view.toast) return;
  const shell = app.querySelector(".app-shell");
  if (shell) shell.insertAdjacentHTML("beforeend", toastMarkup());
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

/**
 * 이미 닫힌 세션 지정을 떨어뜨린다.
 *
 * 그래프 기본값과 노드 라우팅에는 지난 실행에서 고른 세션 id가 그대로 남는다. 그
 * 세션이 닫히면 모든 노드가 "선택한 세션을 사용할 수 없습니다"로 막히고, 사용자는
 * 어디를 고쳐야 하는지 알 수 없다. 살아 있지 않은 세션은 지정하지 않은 것으로 본다.
 */
function dropDeadSession(route: RoutingTarget): RoutingTarget {
  if (!route.sessionId) return route;
  const live = targets.sessions.find((item) => item.id === route.sessionId
    && routeEnvironmentId(item.environmentId) === routeEnvironmentId(route.environmentId)
    && item.connected && item.writable);
  if (!live) delete route.sessionId;
  return route;
}

function routingValue(value: RoutingTarget | undefined): RoutingTarget {
  return {
    ...(value?.environmentId ? { environmentId: value.environmentId } : {}),
    ...(value?.projectId ? { projectId: value.projectId } : {}),
    ...(value?.branch ? { branch: value.branch } : {}),
    ...(value?.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value?.model ? { model: value.model } : {}),
    ...(value?.reasoning ? { reasoning: value.reasoning } : {}),
  };
}

function taskForGraphNode(node: GraphNode): LocalTask | undefined {
  return node.task?.id ? store.tasks.find((task) => task.id === node.task?.id) : undefined;
}

function taskTargetForGraphNode(node: GraphNode): NonNullable<LocalTask["projects"]>[number] | undefined {
  return taskForGraphNode(node)?.projects
    ?.filter((project) => project.role === "target" && project.locatorKind === "folder")
    .sort((left, right) => left.position - right.position)[0];
}

function projectMatchesTaskLocator(projectId: string | undefined, projectPath: string | undefined, locator: string, environmentId: string): boolean {
  if (projectPath === locator) return true;
  if (projectId && targets.branches?.some((branch) => branch.projectId === projectId
    && routeEnvironmentId(branch.environmentId) === environmentId && branch.path === locator)) return true;
  const locatorProjectIds = new Set([
    ...targets.projects.filter((project) => project.path === locator).map((project) => project.id),
    ...(targets.branches ?? []).filter((branch) => branch.path === locator && branch.projectId).map((branch) => branch.projectId!),
  ]);
  return Boolean(projectId && locatorProjectIds.has(projectId));
}

function projectForTaskLocator(locator: string, environmentId: string) {
  return targets.projects.find((project) => routeEnvironmentId(project.environmentId) === environmentId
    && projectMatchesTaskLocator(project.id, project.path, locator, environmentId));
}

function environmentForTaskTargets(projects: NonNullable<LocalTask["projects"]>): string | undefined {
  if (!projects.length) return undefined;
  const environmentIds = [...new Set(targets.projects.map((project) => routeEnvironmentId(project.environmentId)))];
  const matches = environmentIds.flatMap((environmentId) => {
    const environment = targets.environments?.find((item) => item.id === environmentId);
    if (environment?.connected === false) return [];
    let score = 0;
    for (const target of projects) {
      const project = projectForTaskLocator(target.locator, environmentId);
      if (!project) return [];
      const expectedBranch = target.branch ? shortBranch(target.branch) : "";
      const hasBranch = !expectedBranch || shortBranch(project.branch ?? "") === expectedBranch
        || Boolean(targets.branches?.some((branch) => branch.projectId === project.id
          && routeEnvironmentId(branch.environmentId) === environmentId
          && shortBranch(branch.branch) === expectedBranch));
      if (!hasBranch) return [];
      const exactPath = project.path === target.locator || Boolean(targets.branches?.some((branch) =>
        branch.projectId === project.id && routeEnvironmentId(branch.environmentId) === environmentId
        && branch.path === target.locator));
      score += exactPath ? 2 : 1;
    }
    return [{ environmentId, score }];
  });
  const bestScore = Math.max(0, ...matches.map((match) => match.score));
  const best = matches.filter((match) => match.score === bestScore);
  return best.length === 1 ? best[0]!.environmentId : undefined;
}

function inferredTaskNodeRouting(graph: GraphDefinition, node: GraphNode): RoutingTarget {
  const target = taskTargetForGraphNode(node);
  if (!target) return {};
  const route = effectiveRouting(graph, node);
  if (route.sessionId) return {};
  const environmentId = routeEnvironmentId(route.environmentId);
  if (route.projectId) {
    const project = targets.projects.find((item) => item.id === route.projectId
      && routeEnvironmentId(item.environmentId) === environmentId);
    return project && projectMatchesTaskLocator(project.id, project.path, target.locator, environmentId) && !route.branch && target.branch
      ? { branch: shortBranch(target.branch) }
      : {};
  }
  const project = projectForTaskLocator(target.locator, environmentId);
  if (!project) return {};
  return {
    projectId: project.id,
    ...(target.branch ? { branch: shortBranch(target.branch) }
      : project.branch ? { branch: shortBranch(project.branch) } : {}),
  };
}

function graphProjectTargets(graph: GraphDefinition): NonNullable<LocalTask["projects"]> {
  const byLocator = new Map<string, NonNullable<LocalTask["projects"]>[number]>();
  for (const node of graph.nodes) {
    const target = taskTargetForGraphNode(node);
    if (target && !byLocator.has(target.locator)) byLocator.set(target.locator, target);
  }
  return [...byLocator.values()];
}

function runProjectCandidates(environmentIdValue: string | undefined, references: RunProjectReference[]): RunProjectCandidate[] {
  const environmentId = routeEnvironmentId(environmentIdValue);
  return targets.projects
    .filter((project) => routeEnvironmentId(project.environmentId) === environmentId && Boolean(project.worktreeId))
    .map((project) => {
      const reference = references.find((candidate) => projectMatchesTaskLocator(
        project.id, project.path, candidate.locator, environmentId,
      ));
      return {
        project,
        locator: reference?.locator ?? project.path ?? project.id,
        label: reference?.label ?? project.name,
        ...(reference?.branch ? { branch: shortBranch(reference.branch) } : {}),
        saved: Boolean(reference),
      };
    })
    .sort((left, right) => Number(right.saved) - Number(left.saved)
      || Number(Boolean(right.project.current)) - Number(Boolean(left.project.current))
      || left.label.localeCompare(right.label, "ko-KR"));
}

function selectedRunProjectCandidates(
  modal: RunModalState | TaskRunModalState,
  references: RunProjectReference[],
): RunProjectCandidate[] {
  const route = modal.kind === "run" ? modal.defaults : modal.routing;
  const selected = new Set(modal.selectedProjectIds);
  return runProjectCandidates(route.environmentId, references).filter((candidate) => selected.has(candidate.project.id));
}

function runModalReferences(modal: RunModalState | TaskRunModalState): RunProjectReference[] {
  if (modal.kind === "run") return graphProjectTargets(activeGraph());
  if (modal.itemKind !== "task") return [];
  return (store.tasks.find((item) => item.id === modal.itemId)?.projects ?? [])
    .filter((project) => project.role === "target" && project.locatorKind === "folder")
    .sort((left, right) => left.position - right.position);
}

function ensureRunProjectRouting(
  modal: RunModalState | TaskRunModalState,
  candidate: RunProjectCandidate,
): RoutingTarget {
  const base = modal.kind === "run" ? modal.defaults : modal.routing;
  const routing = modal.projectRoutings[candidate.locator] ??= {
    environmentId: routeEnvironmentId(base.environmentId),
    projectId: candidate.project.id,
    ...(candidate.branch ? { branch: candidate.branch }
      : candidate.project.branch ? { branch: shortBranch(candidate.project.branch) } : {}),
    ...(base.model ? { model: base.model } : {}),
    ...(base.reasoning ? { reasoning: base.reasoning } : {}),
  };
  routing.environmentId = routeEnvironmentId(base.environmentId);
  routing.projectId = candidate.project.id;
  return routing;
}

function syncRunPrimaryRouting(modal: RunModalState | TaskRunModalState, references: RunProjectReference[]): void {
  const route = modal.kind === "run" ? modal.defaults : modal.routing;
  const primary = selectedRunProjectCandidates(modal, references)[0];
  delete route.projectId;
  delete route.branch;
  delete route.sessionId;
  if (!primary) return;
  const selected = ensureRunProjectRouting(modal, primary);
  route.projectId = primary.project.id;
  if (selected.branch) route.branch = selected.branch;
  if (selected.sessionId) route.sessionId = selected.sessionId;
}

/** 지금 활성 상태인 Orca 프로젝트. 실행 대상을 추천할 때만 쓴다. */
function currentOrcaProject(): { repoId?: string; path?: string; projectId?: string; branch?: string; worktreeId?: string } | null {
  const project = targets.projects.find((item) => item.current);
  if (!project) return null;
  return {
    ...(project.repoId ? { repoId: project.repoId } : {}),
    ...(project.path ? { path: project.path } : {}),
    projectId: project.id,
    ...(project.branch ? { branch: project.branch } : {}),
    ...(project.worktreeId ? { worktreeId: project.worktreeId } : {}),
  };
}

/** 이 항목을 마지막으로 어디에 보냈는지. 실행 창의 기본값을 채우는 데 쓴다. */
function latestDispatch(itemKind: DispatchRecord["itemKind"], itemId: string): DispatchRecord | undefined {
  return store.dispatchLog.find((record) => record.itemKind === itemKind && record.itemId === itemId);
}

function savedExecutionRouting(target: DispatchTarget | undefined): RoutingTarget | undefined {
  if (!target) return undefined;
  const environmentId = routeEnvironmentId(target.environmentId);
  const model = target.model && targets.models.some((item) => item.id === target.model) ? target.model : undefined;
  const session = target.sessionId
    ? targets.sessions.find((item) => item.id === target.sessionId
      && routeEnvironmentId(item.environmentId) === environmentId && item.connected && item.writable)
    : undefined;
  if (session) {
    return {
      environmentId,
      sessionId: session.id,
      ...(session.projectId ? { projectId: session.projectId } : target.projectId ? { projectId: target.projectId } : {}),
      ...(target.branch || session.branch ? { branch: shortBranch(target.branch || session.branch!) } : {}),
      ...(model ? { model } : {}),
    };
  }
  const project = target.projectId
    ? targets.projects.find((item) => item.id === target.projectId
      && routeEnvironmentId(item.environmentId) === environmentId)
    : undefined;
  if (!project) return undefined;
  return {
    environmentId,
    projectId: project.id,
    ...(target.branch || project.branch ? { branch: shortBranch(target.branch || project.branch!) } : {}),
    ...(model ? { model } : {}),
  };
}

function createRunModal(live: boolean): RunModalState {
  const graph = activeGraph();
  const previousExecution = latestDispatch("graph", graph.id);
  const defaults = dropDeadSession(routingValue(graph.defaults));
  const projectTargets = graphProjectTargets(graph);
  defaults.environmentId = routeEnvironmentId(defaults.environmentId ?? environmentForTaskTargets(projectTargets));
  if (defaults.sessionId) delete defaults.reasoning;
  let suggestedProjectId: string | undefined;
  const hasTaskTarget = graph.nodes.some((node) => Boolean(taskTargetForGraphNode(node)));
  if (!defaults.projectId && !defaults.sessionId && !hasTaskTarget) {
    // 지금 열려 있는 Orca 프로젝트가 가장 그럴듯한 기본값이다. 그것을 모르면
    // 워크트리 이름과 이름이 정확히 하나 일치하는 프로젝트로 물러난다.
    const workspace = currentWorkspaceName.trim().toLocaleLowerCase("en-US");
    const byName = workspace ? targets.projects.filter((item) => {
      const id = item.id.toLocaleLowerCase("en-US");
      const name = item.name.toLocaleLowerCase("en-US");
      return id === workspace || name === workspace || id.endsWith(`/${workspace}`);
    }) : [];
    const suggested = targets.projects.find((item) => item.current)
      ?? (byName.length === 1 ? byName[0] : undefined);
    if (suggested) {
      suggestedProjectId = suggested.id;
      defaults.projectId = suggestedProjectId;
    }
  }
  if (!defaults.sessionId && !defaults.model && targets.models.some((item) => item.id === "gpt-5.6-sol")) {
    defaults.model = "gpt-5.6-sol";
  }
  if (defaults.projectId && !defaults.branch) {
    const branch = targets.projects.find((item) => item.id === defaults.projectId
      && routeEnvironmentId(item.environmentId) === routeEnvironmentId(defaults.environmentId))?.branch;
    if (branch) defaults.branch = shortBranch(branch);
  }
  const activeRun = dataSource.config.mode === "structured"
    ? [...graph.runs].reverse().find((run) => run.status === "running")
    : undefined;
  const failedActiveRun = Boolean(activeRun && graph.nodes.some((node) => node.status === "failed"));
  const inferredProjectNodeIds: string[] = [];
  const nodeRouting = Object.fromEntries(graph.nodes.map((node) => {
    const inferred = inferredTaskNodeRouting(graph, node);
    if (inferred.projectId || inferred.branch) inferredProjectNodeIds.push(node.id);
    return [node.id, dropDeadSession({ ...routingValue(node.routing), ...inferred })];
  }));
  const projectRoutings: Record<string, RoutingTarget> = {};
  for (const target of projectTargets) {
    const node = graph.nodes.find((candidate) => taskTargetForGraphNode(candidate)?.locator === target.locator);
    const route = node ? effectiveRouting({ ...graph, defaults } as GraphDefinition, { ...node, routing: routingValue(nodeRouting[node.id]) }) : defaults;
    const project = projectForTaskLocator(target.locator, routeEnvironmentId(route.environmentId));
    const projectRouting: RoutingTarget = {
      environmentId: routeEnvironmentId(route.environmentId),
      ...(project ? { projectId: project.id } : route.projectId ? { projectId: route.projectId } : {}),
      ...(target.branch ? { branch: shortBranch(target.branch) } : route.branch ? { branch: shortBranch(route.branch) } : project?.branch ? { branch: shortBranch(project.branch) } : {}),
      ...(route.sessionId ? { sessionId: route.sessionId } : {}),
      ...(route.model ? { model: route.model } : defaults.model ? { model: defaults.model } : {}),
      ...(route.reasoning ? { reasoning: route.reasoning } : defaults.reasoning ? { reasoning: defaults.reasoning } : {}),
    };
    if (projectRouting.sessionId) delete projectRouting.reasoning;
    projectRoutings[target.locator] = dropDeadSession(projectRouting);
  }
  const candidates = runProjectCandidates(defaults.environmentId, projectTargets);
  const selectedProjectIds = candidates.filter((candidate) => candidate.saved).map((candidate) => candidate.project.id);
  if (!selectedProjectIds.length && defaults.projectId && candidates.some((candidate) => candidate.project.id === defaults.projectId)) {
    selectedProjectIds.push(defaults.projectId);
  }
  const savedExecutionMode = graph.engineering?.executionMode ?? previousExecution?.executionMode;
  const executionMode: ExecutionMode = selectedProjectIds.length > 1 && savedExecutionMode === "per_project"
    ? "per_project"
    : "single_session";
  if (executionMode === "per_project") {
    for (const target of previousExecution?.targets ?? []) {
      if (!target.locator || !projectRoutings[target.locator]) continue;
      const restored = savedExecutionRouting(target);
      if (restored) projectRoutings[target.locator] = restored;
    }
  }
  const modal: RunModalState = {
    kind: "run",
    live,
    defaults,
    executionMode,
    selectedProjectIds,
    projectRoutings,
    nodeRouting,
    conditionBranches: Object.fromEntries(graph.nodes
      .filter((node) => node.kind === "condition")
      .map((node) => [node.id, node.branchTaken?.trim() ?? ""])),
    inputPrompt: failedActiveRun ? activeRun?.inputPrompt ?? "" : "",
    startNewRun: !activeRun || failedActiveRun,
    autoApprove: true,
    ...(suggestedProjectId ? { suggestedProjectId } : {}),
    ...(inferredProjectNodeIds.length ? { inferredProjectNodeIds } : {}),
  };
  for (const candidate of selectedRunProjectCandidates(modal, projectTargets)) {
    ensureRunProjectRouting(modal, candidate);
  }
  // 그래프 기본값과 고른 프로젝트는 따로 복원된다. 맞춰 두지 않으면 창은 A를
  // 체크한 채 "B에서 새 세션"이라고 말하고, 실행도 B로 간다.
  // 기존 세션을 고른 경우는 그 세션이 실행 위치다. 프로젝트 선택으로 덮지 않는다.
  if (executionMode === "single_session" && selectedProjectIds.length && !defaults.sessionId) {
    syncRunPrimaryRouting(modal, projectTargets);
  }
  return modal;
}

function savedTaskRunSettings(task: LocalTask | undefined): SavedTaskRunSettings | undefined {
  const value = task?.metadata?.[taskRunSettingsMetadataKey];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedTaskRunSettings>;
  if (candidate.schemaVersion !== 1 || !candidate.routing || typeof candidate.routing !== "object"
    || !Array.isArray(candidate.selectedProjectIds) || !candidate.projectRoutings || typeof candidate.projectRoutings !== "object") return undefined;
  return {
    schemaVersion: 1,
    routing: routingValue(candidate.routing),
    executionMode: candidate.executionMode === "per_project" ? "per_project" : "single_session",
    autoApprove: candidate.autoApprove !== false,
    selectedProjectIds: candidate.selectedProjectIds.filter((id): id is string => typeof id === "string"),
    projectRoutings: Object.fromEntries(Object.entries(candidate.projectRoutings)
      .filter((entry): entry is [string, RoutingTarget] => Boolean(entry[0]) && Boolean(entry[1]) && typeof entry[1] === "object")
      .map(([locator, route]) => [locator, routingValue(route)])),
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
  };
}

function createWorkItemRunModal(itemKind: "task" | "todo", item: LocalTask | LocalTodo): TaskRunModalState {
  const task = itemKind === "task" ? item as LocalTask : undefined;
  const savedSettings = savedTaskRunSettings(task);
  const targetFolders = task?.projects?.filter((project) => project.role === "target" && project.locatorKind === "folder") ?? [];
  const previousExecution = latestDispatch(itemKind, item.id);
  const previousPrimaryRouting = savedExecutionRouting(previousExecution?.targets[0]);
  const previousEnvironmentId = previousPrimaryRouting
    && targetFolders.every((project) => Boolean(projectForTaskLocator(project.locator, routeEnvironmentId(previousPrimaryRouting.environmentId))))
    ? previousPrimaryRouting.environmentId
    : undefined;
  const routing: RoutingTarget = {
    environmentId: routeEnvironmentId(previousEnvironmentId ?? environmentForTaskTargets(targetFolders)),
  };
  const sanitizeRoutings = (routings: Record<string, RoutingTarget>): void => {
    for (const value of Object.values(routings)) dropDeadSession(value);
  };
  const projectRoutings: Record<string, RoutingTarget> = {};
  let suggestedProjectId: string | undefined;
  // 지금 열려 있는 Orca 워크트리. `refresh`가 대상 목록에 표시해 둔다.
  const current = currentOrcaProject();
  const currentMatches = current ? targets.projects.filter((project) =>
    routeEnvironmentId(project.environmentId) === routing.environmentId
      && ((current.worktreeId && project.worktreeId === current.worktreeId)
        || (current.repoId && project.repoId === current.repoId)
        || (current.path && project.path === current.path)
        || (current.projectId && project.id === current.projectId))) : [];
  if (currentMatches.length === 1) {
    suggestedProjectId = currentMatches[0]!.id;
    routing.projectId = suggestedProjectId;
    if (current?.branch) routing.branch = shortBranch(current.branch);
    else if (currentMatches[0]!.branch) routing.branch = shortBranch(currentMatches[0]!.branch);
  } else if (currentWorkspaceName) {
    const workspace = currentWorkspaceName.trim().toLocaleLowerCase("en-US");
    const matches = targets.projects.filter((item) => {
      const id = item.id.toLocaleLowerCase("en-US");
      const name = item.name.toLocaleLowerCase("en-US");
      return routeEnvironmentId(item.environmentId) === routing.environmentId
        && (id === workspace || name === workspace || id.endsWith(`/${workspace}`));
    });
    if (matches.length === 1) {
      suggestedProjectId = matches[0]!.id;
      routing.projectId = suggestedProjectId;
      if (matches[0]!.branch) routing.branch = shortBranch(matches[0]!.branch);
    }
  }
  const targetFolder = targetFolders[0];
  if (targetFolder) {
    delete routing.projectId;
    delete routing.branch;
    delete routing.sessionId;
    suggestedProjectId = undefined;
    const project = projectForTaskLocator(targetFolder.locator, routeEnvironmentId(routing.environmentId));
    if (project) {
      suggestedProjectId = project.id;
      routing.projectId = project.id;
      if (targetFolder.branch) routing.branch = shortBranch(targetFolder.branch);
      else if (project.branch) routing.branch = shortBranch(project.branch);
    }
  }
  const defaultModel = targets.models.some((target) => target.id === "gpt-5.6-sol") ? "gpt-5.6-sol" : targets.models[0]?.id;
  if (defaultModel) routing.model = defaultModel;
  for (const targetFolder of targetFolders) {
    const project = projectForTaskLocator(targetFolder.locator, routeEnvironmentId(routing.environmentId));
    projectRoutings[targetFolder.locator] = {
      environmentId: routeEnvironmentId(routing.environmentId),
      ...(project ? { projectId: project.id } : {}),
      ...(targetFolder.branch ? { branch: shortBranch(targetFolder.branch) }
        : project?.branch ? { branch: shortBranch(project.branch) } : {}),
      ...(defaultModel ? { model: defaultModel } : {}),
    };
  }
  const candidates = runProjectCandidates(routing.environmentId, targetFolders);
  const selectedProjectIds = candidates.filter((candidate) => candidate.saved).map((candidate) => candidate.project.id);
  if (!selectedProjectIds.length && routing.projectId && candidates.some((candidate) => candidate.project.id === routing.projectId)) {
    selectedProjectIds.push(routing.projectId);
  }
  if (savedSettings) {
    Object.assign(routing, savedSettings.routing);
    // Task에 대상 프로젝트를 붙여 두지 않았어도 프로젝트별 설정은 그대로 살아야 한다.
    // 예전에는 대상 프로젝트에서 온 locator만 되살려, 그 밖의 선택은 설정을 통째로
    // 잃고 "선택한 Orca 프로젝트를 사용할 수 없습니다"로 실행이 막혔다.
    for (const [locator, savedRouting] of Object.entries(savedSettings.projectRoutings)) {
      projectRoutings[locator] = routingValue(savedRouting);
    }
    const candidateIds = new Set(candidates.map((candidate) => candidate.project.id));
    selectedProjectIds.splice(0, selectedProjectIds.length, ...savedSettings.selectedProjectIds.filter((id) => candidateIds.has(id)));
  }
  const savedMode = savedSettings?.executionMode ?? previousExecution?.executionMode;
  const executionMode: ExecutionMode = itemKind === "task" && selectedProjectIds.length > 1 && savedMode === "per_project"
    ? "per_project"
    : "single_session";
  if (executionMode === "per_project" && !savedSettings) {
    for (const previousTarget of previousExecution?.targets ?? []) {
      if (!previousTarget.locator || !projectRoutings[previousTarget.locator]) continue;
      const restored = savedExecutionRouting(previousTarget);
      if (restored) projectRoutings[previousTarget.locator] = restored;
    }
  } else if (!savedSettings && previousPrimaryRouting) {
    const targetMatches = !targetFolder || (previousPrimaryRouting.projectId && targets.projects.some((project) =>
      project.id === previousPrimaryRouting.projectId
      && routeEnvironmentId(project.environmentId) === routeEnvironmentId(previousPrimaryRouting.environmentId)
      && projectMatchesTaskLocator(project.id, project.path, targetFolder.locator, routeEnvironmentId(previousPrimaryRouting.environmentId))));
    if (targetMatches) Object.assign(routing, previousPrimaryRouting);
  }
  dropDeadSession(routing);
  sanitizeRoutings(projectRoutings);
  const modal: TaskRunModalState = {
    kind: "task-run",
    itemKind,
    itemId: item.id,
    routing,
    executionMode,
    selectedProjectIds,
    projectRoutings,
    autoApprove: savedSettings?.autoApprove !== false,
    ...(suggestedProjectId ? { suggestedProjectId } : {}),
  };
  // 저장해 둔 설정과 고른 프로젝트는 따로 복원된다. 맞춰 두지 않으면 창은 A를
  // 체크한 채 "B에서 새 세션"이라고 말하고, 실행도 B로 간다.
  // 고른 프로젝트에는 반드시 설정이 있어야 한다. 없으면 프로젝트별 실행이 "선택한
  // Orca 프로젝트를 사용할 수 없습니다"로 막힌다 — 그리는 도중에 채우면 그 판정은
  // 이미 끝난 뒤다.
  for (const candidate of selectedRunProjectCandidates(modal, targetFolders)) {
    ensureRunProjectRouting(modal, candidate);
  }
  // 기존 세션을 고른 경우는 그 세션이 실행 위치다. 프로젝트 선택으로 덮지 않는다.
  if (executionMode === "single_session" && selectedProjectIds.length && !routing.sessionId) {
    syncRunPrimaryRouting(modal, targetFolders);
  }
  return modal;
}

function createTaskRunModal(task: LocalTask): TaskRunModalState {
  return createWorkItemRunModal("task", task);
}

function quickGraphCandidates(source: LocalTask): LocalTask[] {
  return store.tasks.filter((task) => task.status !== "archived"
    && task.domainId === source.domainId
    && task.milestoneId === source.milestoneId);
}

function createOrderedTaskGraph(source: LocalTask, nameValue: string, taskIds: string[]): GraphDefinition {
  const name = nameValue.trim();
  if (!name || name.length > 200) throw new Error("그래프 이름은 1자 이상 200자 이하로 입력하십시오.");
  if (source.status === "archived") throw new Error("보관된 Task에서는 그래프를 만들 수 없습니다.");
  if (taskIds.length < 2 || taskIds.length > 100 || taskIds[0] !== source.id || new Set(taskIds).size !== taskIds.length) {
    throw new Error("현재 Task를 첫 번째로 둔 서로 다른 Task 2개 이상 100개 이하를 선택하십시오.");
  }
  const candidates = new Map(quickGraphCandidates(source).map((task) => [task.id, task]));
  const tasks = taskIds.map((taskId) => candidates.get(taskId));
  if (tasks.some((task) => !task)) throw new Error("같은 Domain·Milestone의 활성 Task만 선택할 수 있습니다.");
  const now = new Date().toISOString();
  const nodes: GraphNode[] = tasks.map((task, index) => ({
    id: newId("NODE"),
    kind: "task",
    label: `${index + 1}. ${task!.title}`,
    x: 64 + index * (NODE_WIDTH + 64),
    y: 96,
    status: "pending",
    joinMode: "all",
    task: {
      id: task!.id,
      title: task!.title,
      prompt: task!.prompt,
      ...(task!.version !== undefined ? { version: task!.version } : {}),
      ...(task!.metadata ? { metadata: structuredClone(task!.metadata) } : {}),
    },
    routing: {},
    engineering: { role: "worker", contextMode: "inherit", maxAttempts: 1, permissions: ["read"] },
  }));
  return {
    id: newId("graph"),
    name,
    summary: "",
    status: "draft",
    version: 1,
    pinned: false,
    processEnabled: false,
    routineEnabled: false,
    repeatMode: "none",
    defaults: {},
    runGuards: { claimLeaseSeconds: 21600, stagnationRuns: 3 },
    engineering: { checkpointPolicy: "superstep", requireProvenance: true, humanGateForIrreversible: true, maturity: "experimental" },
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: newId("edge"), from: nodes[index]!.id, to: node.id, kind: "sequence",
    })),
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function runDraftGraph(graph: GraphDefinition, modal: RunModalState): GraphDefinition {
  return {
    ...graph,
    defaults: routingValue(modal.defaults),
    nodes: graph.nodes.map((node) => {
      const target = taskTargetForGraphNode(node);
      const targetRouting = target ? modal.projectRoutings[target.locator] : undefined;
      const selectedRouting = modal.executionMode === "per_project" && target
        && targetRouting?.projectId && modal.selectedProjectIds.includes(targetRouting.projectId)
        ? modal.projectRoutings[target.locator]
        : node.kind === "task" || (node.kind === "condition" && !node.branchTaken?.trim())
          ? {}
          : modal.nodeRouting[node.id];
      const draft = {
        ...node,
        routing: routingValue(selectedRouting),
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
  graph.engineering ??= {};
  graph.engineering.executionMode = modal.executionMode;
  for (const node of graph.nodes) {
    const target = taskTargetForGraphNode(node);
    const targetRouting = target ? modal.projectRoutings[target.locator] : undefined;
    const selectedRouting = modal.executionMode === "per_project" && target
      && targetRouting?.projectId && modal.selectedProjectIds.includes(targetRouting.projectId)
      ? modal.projectRoutings[target.locator]
      : node.kind === "task" || (node.kind === "condition" && !node.branchTaken?.trim())
        ? {}
        : modal.nodeRouting[node.id];
    const routing = routingValue(selectedRouting);
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

function applyTaskRunSettings(task: LocalTask, modal: TaskRunModalState): void {
  const settings: SavedTaskRunSettings = {
    schemaVersion: 1,
    routing: routingValue(modal.routing),
    executionMode: modal.executionMode,
    autoApprove: modal.autoApprove,
    selectedProjectIds: [...modal.selectedProjectIds],
    projectRoutings: Object.fromEntries(Object.entries(modal.projectRoutings)
      .map(([locator, route]) => [locator, routingValue(route)])),
    savedAt: new Date().toISOString(),
  };
  task.metadata = { ...(task.metadata ?? {}), [taskRunSettingsMetadataKey]: settings };
  task.updatedAt = settings.savedAt;
  view.dirty = true;
}

function graphOptions(selected: string): string {
  return store.graphs
    .filter((graph) => graph.status !== "archived" || graph.id === selected)
    .map((graph) => option(graph.id, `${graph.pinned ? "📌 " : ""}${graph.processEnabled ? "🧭 " : ""}${graph.name}`, selected))
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

function projectOptions(selected: string | undefined, inherit = false, environmentId?: string, requiredLocator?: string): string {
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return [
    option("", inherit ? "그래프 기본값 상속" : "프로젝트 미지정", selected),
    ...targets.projects
      .filter((item) => routeEnvironmentId(item.environmentId) === targetEnvironmentId
        && (!requiredLocator || projectMatchesTaskLocator(item.id, item.path, requiredLocator, targetEnvironmentId)))
      .map((item) => option(item.id, item.name, selected)),
  ].join("");
}

function shortBranch(value: string): string {
  return value.replace(/^refs\/heads\//u, "");
}

function sessionOptions(selected: string | undefined, inherit = false, environmentId?: string, _projectId?: string): string {
  const targetEnvironmentId = routeEnvironmentId(environmentId);
  return [
    option("", inherit ? "그래프 기본값 상속" : "세션 미지정 · 새 세션", selected),
    ...targets.sessions
      .filter((item) => routeEnvironmentId(item.environmentId) === targetEnvironmentId)
      .map((item) => option(item.id, `${item.title} · ${projectName(item.projectId, item.environmentId)}${item.branch ? ` · ${shortBranch(item.branch)}` : ""}`, selected)),
  ].join("");
}

function sessionForRoute(route: RoutingTarget, sessionId: string): OrcaTargets["sessions"][number] | undefined {
  return targets.sessions.find((item) => item.id === sessionId
    && routeEnvironmentId(item.environmentId) === routeEnvironmentId(route.environmentId));
}

function syncRouteSession(route: RoutingTarget, sessionId: string): boolean {
  if (!sessionId) {
    delete route.sessionId;
    return true;
  }
  const session = sessionForRoute(route, sessionId);
  if (!session) return false;
  route.sessionId = session.id;
  if (session.projectId) route.projectId = session.projectId;
  if (session.branch) route.branch = shortBranch(session.branch);
  const matchingModel = targets.models.find((item) => item.agent === session.agentType);
  if (matchingModel) route.model = matchingModel.id;
  delete route.reasoning;
  return true;
}

function clearMismatchedRouteSession(route: RoutingTarget): void {
  if (!route.sessionId) return;
  const session = sessionForRoute(route, route.sessionId);
  if (!session || (route.projectId && session.projectId !== route.projectId)) delete route.sessionId;
}

function routingTargetMode(route: RoutingTarget): "worktree" | "session" {
  return route.sessionId ? "session" : "worktree";
}

function setRoutingTargetMode(route: RoutingTarget, mode: string): boolean {
  if (mode !== "session") {
    delete route.sessionId;
    return true;
  }
  const environmentId = routeEnvironmentId(route.environmentId);
  const session = targets.sessions.find((item) => routeEnvironmentId(item.environmentId) === environmentId);
  if (!session) return false;
  return syncRouteSession(route, session.id);
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
        <path aria-hidden="true" class="edge tone-${tone} ${edge.kind} ${branchClass} ${source && visualNodeStatus(graph, source) === "done" ? "completed" : ""} ${source && visualNodeStatus(graph, source) === "running" ? "active-flow" : ""} ${target && visualNodeStatus(graph, target) === "running" ? "into-running" : ""} ${view.selectedEdgeId === edge.id ? "selected" : ""}" d="${path.d}" marker-end="url(#arrow-${tone})"></path>
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
      const executionStatus = visualNodeStatus(graph, node);
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
      const accessibleLabel = `${node.kind === "condition" ? "조건" : node.kind === "graph_call" ? "그래프 호출" : "작업"} 노드 ${title}, 실행 상태 ${visualNodeStatusLabel[executionStatus]}. 클릭하면 ${editorLabel}을 엽니다.`;
      const ports = connectedPorts.get(node.id) ?? new Set<NodeSide>();
      const connectingClass = view.connectingFrom === node.id ? "connecting-source" : view.connectingFrom ? "connecting-target" : "";
      const nodeFindings = analysis.findings.filter((finding) => finding.nodeId === node.id);
      const selected = view.selectedNodeIds.includes(node.id);
      const query = view.nodeQuery.trim().toLocaleLowerCase("ko-KR");
      const searchMatch = !query || `${node.id} ${title} ${nodeSubtitle(node)}`.toLocaleLowerCase("ko-KR").includes(query);
      return `<article class="node ${node.kind} status-${node.status} execution-${executionStatus} ${critical.has(node.id) ? "critical" : ""} ${loopNodes.has(node.id) ? "in-loop" : ""} ${ready(node) ? "ready" : ""} ${branchClosed(node) ? "branch-closed" : ""} ${selected ? "selected" : ""} ${routeMissing ? "route-missing" : ""} ${node.engineering?.layoutPinned ? "layout-pinned" : ""} ${query ? searchMatch ? "search-match" : "search-dim" : ""} ${connectingClass}" data-node-id="${esc(node.id)}" data-drag-node="${esc(node.id)}" data-action="select-node" data-id="${esc(node.id)}" role="button" tabindex="0" aria-label="${esc(accessibleLabel)}" aria-pressed="${selected}" style="left:${node.x}px;top:${node.y}px">
        ${nodeVector(node)}
        <span class="node-status-strip ${executionStatus}"></span>
        ${(["top", "right", "bottom", "left"] as NodeSide[]).map((side) => `<button class="connect-port port-${side} ${ports.has(side) ? "connected" : ""}" data-connect-port data-node-id="${esc(node.id)}" data-side="${side}" aria-label="${esc(title)} ${side} 연결점" title="드래그하여 연결"></button>`).join("")}
        <div class="node-head">
          <span class="node-run-dot ${executionStatus}" aria-hidden="true"></span>
          <span class="node-kind">${nodeIcon(node)}</span>
          <span class="node-title">${esc(title)}</span>
          ${node.engineering?.layoutPinned ? '<span class="node-pin" title="자동 정렬 위치 고정">◆</span>' : ""}
          ${nodeFindings.length ? `<button class="node-problem ${nodeFindings.some((finding) => finding.severity === "error") ? "error" : "warning"}" data-action="focus-problem" data-id="${esc(node.id)}" title="${nodeFindings.length}개 문제">${nodeFindings.length}</button>` : ""}
          <button class="node-edit" data-action="edit-node" data-id="${esc(node.id)}" title="${editorLabel}" aria-label="${esc(title)} ${editorLabel}">편집</button>
          ${nodeExecutionChipMarkup(executionStatus)}
        </div>
        <div class="node-body">
          <div class="node-subtitle" title="${esc(nodeSubtitle(node))}">${esc(nodeSubtitle(node))}</div>
          ${node.kind === "condition"
            ? `<div class="condition-route"><b>${node.branchTaken?.trim() ? `고정 분기 · ${esc(node.branchTaken)}` : `AI 자동 · ${esc(model)}`}</b>${node.branchTaken?.trim() ? "" : `<span>${esc(targetKind)} · ${esc(target)}</span>`}</div>`
            : `<div class="node-route-summary">
                <span class="route-line ${routeMissing ? "missing" : ""} ${nodeOverride ? "override" : ""}" title="${esc(target)}"><b>${targetKind}</b><span>${esc(target)}</span></span>
                <span class="route-line ${routing.sources.model === "node" ? "override" : ""}" title="${esc(routing.model ?? "gpt-5.6-sol")}"><b>AI</b><span>${esc(model)}${routing.reasoning ? ` · ${esc(routing.reasoning)}` : ""}</span></span>
              </div>
              <div class="node-chips node-policy-chips"><span class="chip role-${role}">${esc(role)}</span>${node.joinMode === "any" ? '<span class="chip">OR join</span>' : ""}${loopNodes.has(node.id) ? '<span class="chip loop-chip">↻ loop</span>' : ""}</div>`}
        </div>
        ${nodeRunMetaMarkup(graph, node, executionStatus)}
        ${view.editorMode === "run" && role === "human_gate" ? `<div class="gate-actions"><button data-action="gate-decision" data-id="approved">승인</button><button class="danger" data-action="gate-decision" data-id="rejected">거절</button></div>` : ""}
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

  // 실행이 도는 동안에는 아직 보고가 없는 노드를 뒤로 물려, 지금 무엇이 도는지 보이게 한다.
  const runningNow = Object.values(observedNodeStates(graph.id)).some((state) => state.status === "running");
  return `<div class="canvas-shell zoom-${semanticZoomLevel()} ${runningNow ? "has-run" : ""} ${view.connectingFrom ? "connecting" : ""} mode-${view.editorMode}" data-canvas tabindex="0" style="${gridStyle}">
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
    ${renderCanvasRunBanner(graph)}
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
        <label class="toggle-row"><span>🧭 업무프로세스</span><input type="checkbox" data-action="toggle-process" ${graph.processEnabled ? "checked" : ""}></label>
        ${graph.processEnabled ? `<p class="help">그래프 구조·Task Prompt는 처리 방법이고, 매 run의 업무 입력이 이번 처리 대상을 정합니다.</p>${[...graph.runs].reverse().find((run) => run.status === "running")?.inputPrompt !== undefined ? `<details><summary>현재 run 업무 입력</summary><pre class="run-input">${esc([...graph.runs].reverse().find((run) => run.status === "running")?.inputPrompt ?? "")}</pre></details>` : ""}` : ""}
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
        <label class="field"><span>세션</span><select data-scope="graph-routing" data-field="sessionId">${sessionOptions(graph.defaults.sessionId, false, graph.defaults.environmentId, graph.defaults.projectId)}</select></label>
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
    <label class="field"><span>세션</span><select data-scope="node-routing" data-field="sessionId">${sessionOptions(node.routing?.sessionId, true, route.environmentId, route.projectId)}</select></label>
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
    if (!session?.connected || !session.writable) {
      return [`${label}: 고른 Orca 세션이 닫혔습니다. 실행 위치를 워크트리로 바꾸거나 살아 있는 세션을 고르십시오.`];
    }
    const selectedModel = route.model ? targets.models.find((item) => item.id === route.model) : undefined;
    if (selectedModel && selectedModel.agent !== session.agentType) {
      problems.push(`${label}: 세션은 ${session.agentType}, 모델은 ${selectedModel.agent} 계열입니다.`);
    }
  } else {
    const project = targets.projects.find((item) => item.id === route.projectId && routeEnvironmentId(item.environmentId) === environmentId);
    const requestedBranch = route.branch;
    if (route.projectId && !project?.worktreeId) problems.push(`${label}: 선택한 프로젝트의 Orca 워크트리를 사용할 수 없습니다.`);
    if (!route.projectId && requestedBranch) problems.push(`${label}: 프로젝트 없이 작업 브랜치만 지정할 수 없습니다.`);
    if (project && requestedBranch && !(targets.branches ?? []).some((item) =>
      item.projectId === project.id && routeEnvironmentId(item.environmentId) === environmentId
        && item.branch && shortBranch(item.branch) === shortBranch(requestedBranch) && item.worktreeId)) {
      problems.push(`${label}: 선택한 작업 브랜치의 Orca 워크트리를 사용할 수 없습니다 (${shortBranch(requestedBranch)}).`);
    }
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

/**
 * 실행 대상 트리 — 머신 → 프로젝트 → 워크트리.
 *
 * Orca 사이드바가 보여 주는 것과 같은 묶음과 같은 순서(핀 → 활성 → sortOrder)로
 * 그린다. 고르는 단위는 워크트리다. 어느 체크아웃에서 세션이 열리는지가 곧 실행
 * 위치이므로, 프로젝트만 고르고 브랜치를 따로 고르게 하면 두 값이 어긋난다.
 */
function worktreeRowsFor(project: ProjectTarget, environmentId: string): BranchTarget[] {
  const rows = (targets.branches ?? []).filter((branch) => branch.projectId === project.id
    && routeEnvironmentId(branch.environmentId) === environmentId && branch.worktreeId);
  if (!rows.length && project.worktreeId) {
    // 워크트리 목록을 아직 못 읽었어도 프로젝트가 가리키는 체크아웃 하나는 보여 준다.
    return [{
      id: `${environmentId}:${project.worktreeId}`,
      branch: project.branch ?? "",
      environmentId,
      projectId: project.id,
      worktreeId: project.worktreeId,
      ...(project.path ? { path: project.path } : {}),
      ...(project.current ? { active: true } : {}),
    }];
  }
  return [...rows].sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    || Number(Boolean(right.active)) - Number(Boolean(left.active))
    || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    || worktreeRowLabel(left).localeCompare(worktreeRowLabel(right), "ko-KR"));
}

function worktreeRowLabel(worktree: BranchTarget): string {
  return worktree.displayName || shortBranch(worktree.branch) || worktree.worktreeId;
}

function runTreeEnvironments(): EnvironmentTarget[] {
  const known = targets.environments?.length
    ? [...targets.environments]
    : [{ id: "local", name: "local", local: true, connected: true }];
  return known.sort((left, right) => Number(right.local) - Number(left.local)
    || left.name.localeCompare(right.name, "ko-KR"));
}

function runTreeProjects(environmentId: string): ProjectTarget[] {
  return targets.projects
    .filter((project) => routeEnvironmentId(project.environmentId) === environmentId && Boolean(project.worktreeId))
    .sort((left, right) => Number(Boolean(right.current)) - Number(Boolean(left.current))
      || left.name.localeCompare(right.name, "ko-KR"));
}

/** 이 프로젝트에서 지금 고른 워크트리의 브랜치. 없으면 프로젝트의 기본 체크아웃. */
function selectedBranchFor(
  modal: RunModalState | TaskRunModalState,
  references: RunProjectReference[],
  project: ProjectTarget,
): string {
  const candidate = runProjectCandidates(
    modal.kind === "run" ? modal.defaults.environmentId : modal.routing.environmentId,
    references,
  ).find((item) => item.project.id === project.id);
  const routing = candidate ? modal.projectRoutings[candidate.locator] : undefined;
  const branch = routing?.branch ?? candidate?.branch ?? project.branch ?? "";
  return branch ? shortBranch(branch) : "";
}

function renderRunProjectPicker(
  modal: RunModalState | TaskRunModalState,
  references: RunProjectReference[],
  routingScope: "run-project-routing" | "task-run-project-routing",
): string {
  const base = modal.kind === "run" ? modal.defaults : modal.routing;
  const activeEnvironment = routeEnvironmentId(base.environmentId);
  const selected = selectedRunProjectCandidates(modal, references);
  const perProject = modal.executionMode === "per_project" && selected.length > 1;
  const selectedIds = new Set(modal.selectedProjectIds);
  const environments = runTreeEnvironments();
  const tree = environments.map((environment) => {
    const projects = runTreeProjects(environment.id);
    const isActive = environment.id === activeEnvironment;
    const rows = projects.map((project) => {
      const branch = isActive ? selectedBranchFor(modal, references, project) : "";
      const worktrees = worktreeRowsFor(project, environment.id);
      const checkedWorktree = isActive && selectedIds.has(project.id)
        ? worktrees.find((worktree) => shortBranch(worktree.branch) === branch) ?? worktrees[0]
        : undefined;
      return `<div class="run-target-project" role="group" aria-label="${esc(project.name)}">
        <header><span class="run-target-twisty" aria-hidden="true">▾</span><strong>${esc(project.name)}</strong>${project.current ? '<span class="badge good">활성</span>' : ""}</header>
        ${worktrees.map((worktree) => {
          const checked = checkedWorktree?.worktreeId === worktree.worktreeId;
          return `<label class="run-target-worktree ${checked ? "selected" : ""}">
            <input type="checkbox" data-action="toggle-run-worktree" data-project-id="${esc(project.id)}" data-environment-id="${esc(environment.id)}" data-branch="${esc(shortBranch(worktree.branch))}" ${checked ? "checked" : ""} ${environment.connected === false ? "disabled" : ""}>
            <span><strong>${esc(worktreeRowLabel(worktree))}</strong><small title="${esc(worktree.path ?? worktree.worktreeId)}">${esc(worktree.branch || worktree.path || "")}</small></span>
            <span class="run-target-flags">${worktree.pinned ? '<span title="고정">📌</span>' : ""}${worktree.active ? '<span class="badge good">활성</span>' : ""}${worktree.liveTerminals ? `<span class="badge" title="열린 터미널">⌨ ${worktree.liveTerminals}</span>` : ""}</span>
          </label>`;
        }).join("")}
      </div>`;
    }).join("");
    return `<section class="run-target-environment ${isActive ? "active" : ""}" role="group" aria-label="${esc(environment.name)}">
      <header><span class="run-target-twisty" aria-hidden="true">▾</span><strong>${esc(environment.name)}</strong>${environment.local ? '<span class="badge">이 Orca</span>' : ""}${environment.connected === false ? '<span class="badge bad">연결 안 됨</span>' : ""}</header>
      ${projects.length ? rows : '<p class="help">이 머신에 사용할 수 있는 Orca 프로젝트가 없습니다.</p>'}
    </section>`;
  }).join("");
  return `<div class="run-project-picker" aria-label="실행 대상 선택">
    <header><div><strong>머신 · 프로젝트 · 워크트리</strong><span>선택 · ${selected.length}개</span></div><span class="badge">선택 안 함 가능</span></header>
    ${targets.projects.length
      ? `<div class="run-target-tree" role="group" aria-label="Orca 실행 대상">${tree}</div>`
      : '<p class="help">이 장치의 Orca 프로젝트·워크트리·세션 목록이 비어 있습니다. 도구 모음의 <b>Orca 대상 갱신</b>을 실행한 뒤 패널을 다시 여십시오.</p>'}
    ${perProject
      ? `<div class="task-project-run-grid" aria-label="프로젝트별 세션·모델">${selected.map((candidate) => {
        const route = ensureRunProjectRouting(modal, candidate);
        const targetMode = routingTargetMode(route);
        return `<article class="task-project-run-card"><header><strong>${esc(candidate.project.name)}</strong><span class="badge">${esc(route.branch ? shortBranch(route.branch) : "워크트리")}</span></header><code title="${esc(candidate.locator)}">${esc(candidate.locator)}</code><div class="run-card-grid">
          <label class="field"><span>실행 위치</span><select data-scope="${routingScope}" data-field="targetMode" data-locator="${esc(candidate.locator)}">${option("worktree", "워크트리에서 새 Orca 세션", targetMode)}${option("session", "기존 Orca 세션", targetMode)}</select></label>
          ${targetMode === "session"
            ? `<label class="field"><span>Orca 세션</span><select data-scope="${routingScope}" data-field="sessionId" data-locator="${esc(candidate.locator)}">${sessionOptions(route.sessionId, false, route.environmentId, route.projectId)}</select></label>`
            : ""}
          <label class="field"><span>AI 모델</span><select data-scope="${routingScope}" data-field="model" data-locator="${esc(candidate.locator)}">${modelOptions(route.model)}</select></label>
          ${modelReasoningLevels(targets, route.model).length
            ? `<label class="field"><span>Reasoning</span><select data-scope="${routingScope}" data-field="reasoning" data-locator="${esc(candidate.locator)}">${reasoningOptions(route.reasoning, route.model, { existingSession: Boolean(route.sessionId) })}</select></label>`
            : ""}
        </div></article>`;
      }).join("")}</div>`
      : selected.length ? "" : '<div class="run-context-fallback"><strong>선택 안 함</strong><span>선택한 머신의 현재 Orca 컨텍스트에서 새 세션을 시작합니다.</span></div>'}
  </div>`;
}

/** 실행 하나를 펼쳐 본다 — 무엇을 어디로 보냈고, 그 세션이 지금 어떤 상태인지. */
function renderDispatchDetail(recordId: string): string {
  const records = store.dispatchLog.filter((item) => item.id === recordId);
  const record = records[0];
  if (!record) {
    return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">실행 상세</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body"><p class="warning-list">이 실행 기록을 찾을 수 없습니다.</p></div>
      <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
    </section></div>`;
  }
  const kindLabel = record.itemKind === "graph" ? "Graph" : record.itemKind === "task" ? "Task" : "Todo";
  const history = store.dispatchLog
    .filter((item) => item.itemKind === record.itemKind && item.itemId === record.itemId && item.id !== record.id);
  return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><span class="execution-kind">${kindLabel}</span><strong id="modal-title">${esc(record.title)}</strong><span class="badge">${record.executionMode === "per_project" ? "프로젝트별" : "통합"}</span><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
    <div class="modal-body">
      <p class="help">${esc(record.itemId)} · ${esc(new Date(record.dispatchedAt).toLocaleString("ko-KR"))}${relativeTime(record.dispatchedAt) ? ` · ${esc(relativeTime(record.dispatchedAt))}` : ""}</p>
      ${record.error ? `<p class="dispatch-error" role="alert">세션에 전달하지 못했습니다 · ${esc(record.error)}</p>` : ""}
      <section class="section"><div class="section-title">보낸 대상 ${record.targets.length}</div>
        ${record.targets.length
          ? `<div class="dispatch-targets">${record.targets.map(dispatchTargetLine).join("")}</div>`
          : '<p class="help">전달된 대상이 없습니다.</p>'}
      </section>
      ${record.prompt
        ? `<section class="section"><div class="section-title">보낸 프롬프트${record.promptTruncated ? ' <span class="badge">앞부분만 기록됨</span>' : ""}</div>
            <pre class="dispatch-prompt">${esc(record.prompt)}</pre>
          </section>`
        : '<p class="help">이 기록에는 프롬프트가 남아 있지 않습니다. 이 버전 이전에 보낸 실행입니다.</p>'}
      ${record.itemKind === "graph" ? `<section class="section"><div class="section-title">Graph run 이력</div>${renderGraphRunTimeline(record.itemId)}</section>` : ""}
      ${history.length
        ? `<section class="section"><div class="section-title">같은 항목의 이전 실행 ${history.length}</div>
            <ul class="dispatch-history-list">${history.map((item) => `<li><button data-action="open-dispatch-detail" data-id="${esc(item.id)}"><time>${esc(new Date(item.dispatchedAt).toLocaleString("ko-KR"))}</time><span>${esc(item.targets.map((target) => target.projectName || target.label).join(", ") || "대상 없음")}</span>${item.error ? '<span class="bad">실패</span>' : ""}</button></li>`).join("")}</ul>
          </section>`
        : ""}
    </div>
    <div class="modal-actions"><button data-action="open-execution-item" data-kind="${record.itemKind}" data-id="${esc(record.itemId)}">${kindLabel} 열기</button><button data-action="close-modal">닫기</button></div>
  </section></div>`;
}

function renderModal(): string {
  if (!view.modal) return "";
  if (view.modal.kind === "dispatch-detail") return renderDispatchDetail(view.modal.recordId);
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
            <p class="help">토큰 값은 설정이나 Graph 파일에 저장하지 않습니다. 저장 명령을 보낼 터미널의 환경변수 이름만 기록합니다.</p>
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
  if (view.modal.kind === "quick-graph") {
    const modal = view.modal;
    const source = store.tasks.find((task) => task.id === modal.sourceTaskId);
    if (!source) {
      return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><strong id="modal-title">빠른 그래프 구성</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
        <div class="modal-body"><p class="warning-list">현재 Task를 찾을 수 없습니다.</p></div>
        <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
      </section></div>`;
    }
    const byId = new Map(quickGraphCandidates(source).map((task) => [task.id, task]));
    const needle = modal.query.trim().toLocaleLowerCase("ko-KR");
    const visible = [...byId.values()].filter((task) => task.id === source.id || !needle
      || `${task.title} ${task.id}`.toLocaleLowerCase("ko-KR").includes(needle));
    const scope = itemScope(source);
    const invalidSelection = modal.selectedIds.length < 2 || modal.selectedIds.length > 100
      || modal.selectedIds[0] !== source.id || new Set(modal.selectedIds).size !== modal.selectedIds.length
      || modal.selectedIds.some((id) => !byId.has(id));
    return `<div class="modal-backdrop"><section class="modal wide quick-graph-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">빠른 그래프 구성</strong><span class="badge">${esc(source.id)}</span><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p class="help">현재 Task를 1번으로 고정하고 같은 Domain·Milestone의 Task를 고른 순서대로 연결합니다.</p>
        ${modal.error ? `<p class="warning-list" role="alert">${esc(modal.error)}</p>` : ""}
        <div class="quick-graph-heading"><label class="field"><span>새 그래프 이름</span><input data-action="quick-graph-name" value="${esc(modal.name)}" maxlength="200"></label><span class="quick-graph-scope"><span class="badge">${esc(scope.domain?.name ?? "Domain 미지정")}</span><span>›</span><span class="badge">${esc(scope.milestone?.name ?? "Milestone 미지정")}</span></span></div>
        <section class="quick-graph-order" aria-label="선택한 실행 순서"><header><strong>실행 순서</strong><span>${modal.selectedIds.length}개 Task</span></header><ol>${modal.selectedIds.map((id, index) => {
          const selected = id === source.id ? source : byId.get(id);
          return `<li><span class="quick-graph-index">${index + 1}</span><span class="quick-graph-order-title" title="${esc(selected?.title ?? id)}">${esc(selected?.title ?? id)}</span>${index === 0 ? '<span class="badge">현재 Task</span>' : `<span class="quick-graph-order-actions"><button data-action="move-quick-graph-task" data-id="${esc(id)}" data-delta="-1" aria-label="${esc(selected?.title ?? id)} 순서 앞으로" ${modal.busy || index === 1 ? "disabled" : ""}>↑</button><button data-action="move-quick-graph-task" data-id="${esc(id)}" data-delta="1" aria-label="${esc(selected?.title ?? id)} 순서 뒤로" ${modal.busy || index === modal.selectedIds.length - 1 ? "disabled" : ""}>↓</button><button class="ghost" data-action="toggle-quick-graph-task" data-id="${esc(id)}" aria-label="${esc(selected?.title ?? id)} 선택 해제" ${modal.busy ? "disabled" : ""}>×</button></span>`}</li>`;
        }).join("")}</ol></section>
        <label class="field"><span>같은 범위 Task 검색</span><input data-action="quick-graph-search" value="${esc(modal.query)}" placeholder="Task 제목·ID 검색"></label>
        <div class="quick-graph-candidates" role="listbox" aria-label="그래프 후보 Task">${visible.length ? visible.map((task) => {
          const order = modal.selectedIds.indexOf(task.id);
          const fixed = task.id === source.id;
          return `<button role="option" aria-selected="${order >= 0 ? "true" : "false"}" class="quick-graph-candidate ${order >= 0 ? "selected" : ""}" data-action="toggle-quick-graph-task" data-id="${esc(task.id)}" ${modal.busy || fixed ? "disabled" : ""}><span class="quick-graph-index">${order >= 0 ? order + 1 : "+"}</span><span><strong>${esc(task.title)}</strong><small>${esc(taskStatusLabel[task.status])} · ${esc(task.id)}</small></span>${fixed ? '<span class="badge">시작점</span>' : order >= 0 ? `<span class="badge">${order + 1}번</span>` : ""}</button>`;
        }).join("") : '<p class="help">같은 범위의 Task가 없습니다.</p>'}</div>
      </div>
      <div class="modal-actions quick-graph-footer"><span class="help">생성 결과: Task ${modal.selectedIds.length}개 · 순차 연결 ${Math.max(0, modal.selectedIds.length - 1)}개</span><button data-action="close-modal" ${modal.busy ? "disabled" : ""}>취소</button><button class="primary" data-action="confirm-quick-graph" ${modal.busy || !modal.name.trim() || invalidSelection ? "disabled" : ""}>${modal.busy ? "구성 중…" : "이 순서로 그래프 만들기"}</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "todo-graph-picker") {
    const modal = view.modal;
    return `<div class="modal-backdrop"><section class="modal wide todo-graph-picker" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><span><strong id="modal-title">워크트리 Graph 선택</strong><small>${esc(modal.taskTitle)} · ${esc(modal.taskId)}</small></span><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body">
        <p class="help">연결된 Task가 노드로 포함된 ${workspaceProductName}의 미리 정의된 Graph입니다. 상세와 실행 표면으로 이동할 Graph를 선택하십시오.</p>
        <div class="todo-graph-grid" role="list" aria-label="연결된 워크트리 Graph">
          ${modal.graphs.map((graph) => `<button class="todo-graph-card" role="listitem" data-action="select-todo-graph" data-id="${esc(graph.id)}"><span class="todo-graph-symbol" aria-hidden="true">⬡</span><span><strong>${esc(graph.name)}</strong><small>${esc(graph.id)}</small></span><span class="badge status-${esc(graph.status)}">${esc(graph.status)}</span><b>선택 →</b></button>`).join("")}
        </div>
      </div>
      <div class="modal-actions"><span class="help">Graph ${modal.graphs.length}개</span><button data-action="close-modal">취소</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "task-run") {
    const modal = view.modal;
    const pending = Boolean(modal.busy || modal.saving);
    const item = modal.itemKind === "task"
      ? store.tasks.find((candidate) => candidate.id === modal.itemId)
      : store.todos.find((candidate) => candidate.id === modal.itemId);
    const itemLabel = modal.itemKind === "task" ? "Task" : "Todo";
    if (!item) {
      return `<div class="modal-backdrop"><section class="modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><strong id="modal-title">${itemLabel} 워크트리 실행</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
        <div class="modal-body"><p class="warning-list">선택한 ${itemLabel}를 찾을 수 없습니다.</p></div>
        <div class="modal-actions"><button data-action="close-modal">닫기</button></div>
      </section></div>`;
    }
    const route = routingValue(modal.routing);
    const taskTargetProjects = modal.itemKind === "task"
      ? ((item as LocalTask).projects ?? [])
        .filter((project) => project.role === "target" && project.locatorKind === "folder")
        .sort((left, right) => left.position - right.position)
      : [];
    const selectedProjects = selectedRunProjectCandidates(modal, taskTargetProjects);
    const perProject = modal.itemKind === "task" && selectedProjects.length > 1 && modal.executionMode === "per_project";
    const target = route.sessionId
      ? `기존 세션 · ${sessionName(route.sessionId, route.environmentId)}`
      : route.projectId ? `새 세션 · ${projectName(route.projectId, route.environmentId)}` : "현재 Orca 컨텍스트";
    const savedLocators = new Set(taskTargetProjects.map((project) => project.locator));
    const willLinkTarget = dataSource.config.mode === "structured" && modal.itemKind === "task"
      && selectedProjects.some((candidate) => Boolean(candidate.project.path) && !savedLocators.has(candidate.locator));
    const prompt = modal.itemKind === "task"
      ? (item as LocalTask).prompt
      : currentMetaRevision(item)?.content || item.draft || (item as LocalTodo).notes;
    const projectProblems = perProject ? selectedProjects.flatMap((project) => {
      const projectRoute = routingValue(modal.projectRoutings[project.locator]);
      const routeProject = targets.projects.find((targetProject) => targetProject.id === projectRoute.projectId
        && routeEnvironmentId(targetProject.environmentId) === routeEnvironmentId(projectRoute.environmentId));
      return [
        ...(!routeProject || routeProject.id !== project.project.id
          ? [`${project.label}: 선택한 Orca 프로젝트를 사용할 수 없습니다.`]
          : []),
        ...routingProblemMessages(project.label, projectRoute),
      ];
    }) : [];
    const problems = [
      ...(modal.itemKind === "task" && item.status === "archived" ? [`${item.title}: 보관된 Task는 실행할 수 없습니다.`] : []),
      ...(modal.itemKind === "todo" && item.status === "cancelled" ? [`${item.title}: 취소된 Todo는 실행할 수 없습니다.`] : []),
      ...(!prompt.trim() ? [`${item.title}: 실행할 Prompt가 없습니다.`] : []),
      ...(perProject ? projectProblems : routingProblemMessages(item.title, route)),
    ];
    const assignmentLabel = perProject ? "프로젝트별 세션·모델" : "통합 세션·모델";
    return `<div class="modal-backdrop"><section class="modal wide run-modal ${pending ? "is-busy" : ""}" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title" aria-busy="${pending ? "true" : "false"}">
      <div class="modal-head"><strong id="modal-title">${itemLabel} 실행</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기" ${pending ? "disabled" : ""}>×</button></div>
      <div class="modal-body">
        <section class="run-launch-summary"><span class="run-step">1</span><div><strong>${esc(item.title)}</strong><small>${esc(item.id)} · ${esc(assignmentLabel)}</small></div><span class="badge">${esc(item.status)}</span></section>
        <section class="section run-choice-section">
          <div class="section-title"><span class="run-step">2</span> 실행 머신과 배정 방식 ${modal.suggestedProjectId && route.projectId === modal.suggestedProjectId ? '<span class="badge good">현재 프로젝트 추천</span>' : ""}${willLinkTarget ? '<span class="badge good">Task 대상에 저장</span>' : ""}</div>
          <div class="run-choice-grid"><label class="field"><span>실행 머신</span><select data-scope="task-run-routing" data-field="environmentId">${environmentOptions(route.environmentId)}</select></label>${selectedProjects.length > 1 ? `<label class="field"><span>세션·모델 배정</span><select data-scope="task-run-mode" data-field="executionMode">${option("single_session", "통합 세션 · 통합 모델", modal.executionMode)}${option("per_project", "프로젝트별 세션 · 모델", modal.executionMode)}</select></label>` : `<label class="field"><span>세션·모델 배정</span><select disabled>${option("single_session", "통합 세션 · 통합 모델", "single_session")}</select></label>`}</div>
        </section>
        <section class="section run-defaults">
          <div class="section-title"><span class="run-step">3</span> 프로젝트 · 브랜치/워크트리 · Orca 세션 <span class="badge">모두 선택사항</span></div>
          ${renderRunProjectPicker(modal, taskTargetProjects, "task-run-project-routing")}
          ${perProject ? "" : `<div class="run-routing-grid">
            <label class="field"><span>통합 실행 위치</span><select data-scope="task-run-routing" data-field="targetMode">${option("worktree", selectedProjects.length ? "첫 선택 프로젝트에서 새 Orca 세션" : "현재 Orca 컨텍스트에서 새 세션", routingTargetMode(route))}${option("session", "기존 Orca 세션", routingTargetMode(route))}</select></label>
            ${route.sessionId ? `<label class="field"><span>Orca 세션</span><select data-scope="task-run-routing" data-field="sessionId">${sessionOptions(route.sessionId, false, route.environmentId, route.projectId)}</select></label>` : ""}
            <label class="field"><span>통합 AI 모델</span><select data-scope="task-run-routing" data-field="model">${modelOptions(route.model)}</select></label>
          </div>`}
          <div class="run-route-effective"><strong>${esc(environmentName(route.environmentId))} · ${esc(target)}${route.branch ? ` · ${esc(shortBranch(route.branch))}` : ""}</strong><span>AI · ${esc(modelName(route.model))}</span></div>
          <label class="run-auto-approve"><input type="checkbox" data-action="toggle-task-run-auto-approve" ${modal.autoApprove ? "checked" : ""}><span><strong>승인 없이 실행</strong><small>새로 여는 세션의 권한·승인 질문을 끕니다. 끄면 첫 명령에서 사람을 기다리므로 원격 실행이 멈춥니다.</small></span></label>
        </section>
        ${modal.error ? `<div class="run-submit-error" role="alert"><strong>${modal.errorAction === "save" ? "실행 설정을 저장하지 못했습니다." : "실행을 시작하지 못했습니다."}</strong><span>${esc(modal.error)}</span></div>` : ""}
        ${problems.length ? `<div class="run-configuration-errors" role="alert"><strong>실행 전에 ${problems.length}개 설정을 확인하십시오.</strong><ul>${problems.map((message) => `<li>${esc(message)}</li>`).join("")}</ul></div>` : `<p class="status-pill good">${modal.saving ? "실행 설정을 저장하는 중입니다…" : modal.busy ? "프로젝트 연결과 실행 세션을 준비하는 중입니다…" : `${esc(assignmentLabel)} 준비 완료`}</p>`}
      </div>
      <div class="modal-actions"><button data-action="close-modal" ${pending ? "disabled" : ""}>취소</button>${modal.itemKind === "task" ? `<button data-action="save-task-run-settings" ${pending ? "disabled" : ""}>${modal.saving ? "저장 중…" : "저장"}</button>` : ""}<button class="primary" data-action="confirm-task-run" ${problems.length || pending ? "disabled" : ""}>${modal.busy ? "실행 요청 중…" : "▶ 실행 시작"}</button></div>
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
        ${dataSource.config.mode === "structured"
          ? `<p class="help">이 데이터 원천은 삭제 대신 보관만 지원합니다. 보관하면 목록에서 내려가고 언제든 복원할 수 있습니다.${links.length ? ` 연결된 그래프 노드 ${links.length}개와 Prompt 이력은 그대로 둡니다.` : ""}</p>`
          : `<p class="help">이 Task와 Prompt 이력을 저장소에서 지웁니다. 되돌릴 수 없습니다.${links.length ? ` 이 Task를 쓰는 그래프 노드 ${links.length}개는 남으며, 각 노드가 들고 있는 프롬프트 사본으로 계속 실행됩니다.` : ""}</p>`}
      </div>
      <div class="modal-actions"><button data-action="close-modal">취소</button><button class="danger" data-action="confirm-task-delete">${dataSource.config.mode === "structured" ? "Task 보관" : "영구 삭제"}</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "run") {
    const modal = view.modal;
    const pending = Boolean(modal.busy || modal.saving);
    const sourceGraph = activeGraph();
    const graph = runDraftGraph(sourceGraph, view.modal);
    const analysis = analyzeGraph(graph, { targets });
    const draftGraphs = store.graphs.map((item) => item.id === graph.id ? graph : item);
    const linkFindings = validateGraphLinks(draftGraphs).filter((finding) => finding.graphId === graph.id);
    // 실행 자체는 대상 세션의 에이전트가 수행하므로 실행기 종류에 따른 제약은 없다.
    // 여기 남는 것은 그래프 구조가 실제로 잘못됐을 때뿐이다.
    const blockers = [
      ...analysis.findings.filter((finding) => finding.severity === "error").map((finding) => finding.message),
      ...linkFindings.filter((finding) => finding.severity === "error").map((finding) => finding.message),
    ];
    const routingProblems = runRoutingProblems(graph);
    const projectTargets = graphProjectTargets(sourceGraph);
    const selectedProjects = selectedRunProjectCandidates(modal, projectTargets);
    const perProject = selectedProjects.length > 1 && view.modal.executionMode === "per_project";
    const projectProblems = perProject ? selectedProjects.flatMap((project) => {
      const route = routingValue(modal.projectRoutings[project.locator]);
      const selected = targets.projects.find((item) => item.id === route.projectId
        && routeEnvironmentId(item.environmentId) === routeEnvironmentId(route.environmentId));
      return !selected || selected.id !== project.project.id
        ? [`${project.label}: 선택한 Orca 프로젝트를 사용할 수 없습니다.`]
        : [];
    }) : [];
    const activeProcessRun = dataSource.config.mode === "structured"
      ? [...sourceGraph.runs].reverse().find((run) => run.status === "running")
      : undefined;
    const activeProcessRunFailed = Boolean(activeProcessRun && sourceGraph.nodes.some((node) => node.status === "failed"));
    const processInputMissing = graph.processEnabled && view.modal.startNewRun && !view.modal.inputPrompt.trim();
    const problems = [...blockers, ...projectProblems, ...routingProblems.map((problem) => problem.message)];
    const blocked = problems.length > 0 || processInputMissing;
    const defaultRoute = graph.defaults.sessionId
      ? `기존 세션 · ${sessionName(graph.defaults.sessionId, graph.defaults.environmentId)}`
      : graph.defaults.projectId ? `새 세션 · ${projectName(graph.defaults.projectId, graph.defaults.environmentId)}` : "현재 Orca 컨텍스트";
    const assignmentLabel = perProject ? "프로젝트별 세션·모델" : "통합 세션·모델";
    return `<div class="modal-backdrop"><section class="modal wide run-modal ${pending ? "is-busy" : ""}" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title" aria-busy="${pending ? "true" : "false"}">
      <div class="modal-head"><strong id="modal-title">${view.modal.live ? "그래프 실행" : "실행 계획 생성"}</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기" ${pending ? "disabled" : ""}>×</button></div>
      <div class="modal-body">
        <section class="run-launch-summary"><span class="run-step">1</span><div><strong>${graph.processEnabled ? "🧭 " : ""}${esc(graph.name)}</strong><small>노드 ${graph.nodes.length}개 · ${esc(assignmentLabel)}</small></div><span class="badge">${view.modal.live ? "실행" : "계획"}</span></section>
        ${graph.processEnabled ? `<section class="section process-run-input">
          <div class="section-title">이번 업무 ${activeProcessRun && !activeProcessRunFailed ? `<select data-scope="run-process" data-field="startNewRun" aria-label="Run 방식">${option("resume", `Run #${activeProcessRun.runNo} 재개`, view.modal.startNewRun ? "new" : "resume")}${option("new", "새 Run", view.modal.startNewRun ? "new" : "resume")}</select>` : `<span class="badge">${activeProcessRunFailed ? `실패 Run #${activeProcessRun?.runNo} 재실행` : "새 Run"}</span>`}</div>
          <label class="field"><span>${view.modal.startNewRun ? "업무 입력 · 필수" : "저장된 업무 입력"}</span><textarea data-scope="run-process" data-field="inputPrompt" ${view.modal.startNewRun ? 'placeholder="이번 실행에서 처리할 업무를 입력하십시오."' : "readonly"}>${esc(view.modal.startNewRun ? view.modal.inputPrompt : activeProcessRun?.inputPrompt ?? "")}</textarea></label>
          ${processInputMissing ? '<p class="warning-list">업무 입력을 입력하십시오.</p>' : ""}
        </section>` : ""}
        <section class="section run-choice-section">
          <div class="section-title"><span class="run-step">2</span> 실행 머신과 배정 방식</div>
          <div class="run-choice-grid"><label class="field"><span>실행 머신</span><select data-scope="run-routing" data-field="environmentId">${environmentOptions(view.modal.defaults.environmentId)}</select></label>${selectedProjects.length > 1 ? `<label class="field"><span>세션·모델 배정</span><select data-scope="run-mode" data-field="executionMode">${option("single_session", "통합 세션 · 통합 모델", view.modal.executionMode)}${option("per_project", "프로젝트별 세션 · 모델", view.modal.executionMode)}</select></label>` : `<label class="field"><span>세션·모델 배정</span><select disabled>${option("single_session", "통합 세션 · 통합 모델", "single_session")}</select></label>`}</div>
        </section>
        <section class="section run-defaults">
          <div class="section-title"><span class="run-step">3</span> 프로젝트 · 브랜치/워크트리 · Orca 세션 <span class="badge">모두 선택사항</span> ${view.modal.suggestedProjectId && graph.defaults.projectId === view.modal.suggestedProjectId ? '<span class="badge good">현재 프로젝트 추천</span>' : ""}</div>
          ${renderRunProjectPicker(modal, projectTargets, "run-project-routing")}
          ${perProject ? "" : `<div class="run-routing-grid"><label class="field"><span>통합 실행 위치</span><select data-scope="run-routing" data-field="targetMode">${option("worktree", selectedProjects.length ? "첫 선택 프로젝트에서 새 Orca 세션" : "현재 Orca 컨텍스트에서 새 세션", routingTargetMode(graph.defaults))}${option("session", "기존 Orca 세션", routingTargetMode(graph.defaults))}</select></label>${graph.defaults.sessionId ? `<label class="field"><span>Orca 세션</span><select data-scope="run-routing" data-field="sessionId">${sessionOptions(view.modal.defaults.sessionId, false, view.modal.defaults.environmentId, view.modal.defaults.projectId)}</select></label>` : ""}<label class="field"><span>통합 AI 모델</span><select data-scope="run-routing" data-field="model">${modelOptions(view.modal.defaults.model)}</select></label></div>`}
          <div class="run-route-effective"><strong>${esc(environmentName(graph.defaults.environmentId))} · ${esc(defaultRoute)}${graph.defaults.branch ? ` · ${esc(shortBranch(graph.defaults.branch))}` : ""}</strong><span>AI · ${esc(modelName(graph.defaults.model))}</span></div>
          <label class="run-auto-approve"><input type="checkbox" data-action="toggle-run-auto-approve" ${modal.autoApprove ? "checked" : ""}><span><strong>승인 없이 실행</strong><small>새로 여는 세션의 권한·승인 질문을 끕니다. 끄면 첫 명령에서 사람을 기다리므로 원격 실행이 멈춥니다.</small></span></label>
        </section>
        ${modal.error ? `<div class="run-submit-error" role="alert"><strong>${modal.errorAction === "save" ? "실행 설정을 저장하지 못했습니다." : "실행을 시작하지 못했습니다."}</strong><span>${esc(modal.error)}</span></div>` : ""}
        ${problems.length ? `<div class="run-configuration-errors" role="alert"><strong>실행 전에 ${problems.length}개 설정을 확인하십시오.</strong><ul>${problems.slice(0, 5).map((message) => `<li>${esc(message)}</li>`).join("")}</ul>${problems.length > 5 ? `<small>외 ${problems.length - 5}개</small>` : ""}</div>` : `<p class="status-pill good">${modal.saving ? "그래프 실행 설정을 저장하는 중입니다…" : modal.busy ? "그래프를 저장하고 실행 세션을 준비하는 중입니다…" : `${esc(assignmentLabel)} 준비 완료 · 조건 분기는 실행 중 자동 판정`}</p>`}
      </div>
      <div class="modal-actions"><button data-action="close-modal" ${pending ? "disabled" : ""}>취소</button><button data-action="save-run-settings" ${pending ? "disabled" : ""}>${modal.saving ? "저장 중…" : "저장"}</button><button class="primary" data-action="confirm-run" ${blocked || pending ? "disabled" : ""}>${modal.busy ? "실행 요청 중…" : view.modal.live ? "▶ 실행 시작" : "실행 계획 만들기"}</button></div>
    </section></div>`;
  }
  if (view.modal.kind === "history") {
    const graph = activeGraph();
    return `<div class="modal-backdrop"><section class="modal wide" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head"><strong id="modal-title">실행 이력 · ${esc(graph.name)}</strong><button class="icon ghost" data-action="close-modal" data-modal-initial-focus aria-label="닫기">×</button></div>
      <div class="modal-body run-history">
        ${graph.runs.length ? [...graph.runs].reverse().map((run) => `<article class="run-card">
          <header><strong>Run #${run.runNo}</strong><span class="badge run-${run.status}">${run.status}</span><span>${esc(run.trigger ?? "manual")}</span></header>
          ${run.inputPrompt !== undefined ? `<section class="run-input-history"><strong>업무 입력</strong><pre class="run-input">${esc(run.inputPrompt)}</pre></section>` : ""}
          <p>${esc(run.summary ?? run.terminationReason ?? "기록된 요약 없음")}</p>
          ${run.parentRunId ? `<p class="help">부모 ${esc(run.parentGraphId ?? "graph")} · ${esc(run.parentNodeId ?? "node")} · ${esc(run.parentRunId)}</p>` : ""}
          ${run.childRunIds?.length ? `<p class="help">자식 run · ${run.childRunIds.map(esc).join(" · ")}</p>` : ""}
          <small>${new Date(run.startedAt).toLocaleString("ko-KR")}${run.endedAt ? ` → ${new Date(run.endedAt).toLocaleString("ko-KR")}` : ""}</small>
          ${run.stats ? `<div class="run-metrics"><span>완료 <b>${run.stats.completed ?? 0}</b></span><span>실패 <b>${run.stats.failed ?? 0}</b></span><span>시도 <b>${run.stats.attempts ?? 0}</b></span><span>${Math.round((run.stats.durationMs ?? 0) / 1000)}s</span></div>` : ""}
          ${run.nodeResults?.length ? `<details><summary>노드 결과 ${run.nodeResults.length}</summary><ul class="finding-list">${run.nodeResults.map((result) => `<li class="${result.status === "failed" ? "error" : "info"}"><b>${esc(graph.nodes.find((node) => node.id === result.nodeId)?.label ?? result.nodeId)}</b> · ${result.status} · attempt ${result.attempt ?? 1}${result.durationMs ? ` · ${Math.round(result.durationMs / 1000)}s` : ""}${result.childGraphId ? `<br>child ${esc(result.childGraphId)}${result.childRunId ? ` · ${esc(result.childRunId)}` : ""}` : ""}${result.message ? `<br>${esc(result.message)}` : ""}</li>`).join("")}</ul></details>` : ""}
        </article>`).join("") : '<div class="graph-list-empty"><strong>실행 이력이 없습니다.</strong><span>그래프를 실행하면 이곳에 기록됩니다.</span></div>'}
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
        const dispatched = latestDispatch("graph", item.id);
        return `<article class="graph-list-row ${item.id === store.activeGraphId ? "active" : ""}">
          <button class="graph-row-main" data-action="open-list-graph" data-id="${esc(item.id)}">
            <span class="graph-status-dot run-${runStage}" title="${esc(graphRunTitle(item))}"></span>
            <span class="graph-row-copy"><span class="graph-row-name">${item.pinned ? "📌 " : ""}${item.processEnabled ? "🧭 " : ""}${esc(item.name)}</span><span class="graph-row-summary">${esc(item.summary || "설명이 없습니다.")}</span></span>
            <span class="graph-row-badges">${dispatched ? `<span class="dispatch-inline" title="${esc(new Date(dispatched.dispatchedAt).toLocaleString("ko-KR"))} 세션으로 보냄">↗ 보냄</span>` : ""}${item.processEnabled ? '<span class="badge process">🧭 업무프로세스</span>' : ""}<span class="badge status-${item.status}" title="원천 그래프 상태: ${graphStatusLabel[item.status]}">${graphStatusBadgeLabel(item)}</span><span class="badge run-${runStage}" title="${esc(graphRunTitle(item))}">최근 실행 · ${graphRunLabel(item)}</span></span>
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
      <label class="graph-search"><span>⌕</span><input data-action="work-search" value="${esc(view.workQuery)}" ${kind === "task" ? 'placeholder="제목, ID 검색"' : ""} aria-label="${kind} 검색"></label>
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
  return `<section class="prompt-pair" aria-label="Draft와 Meta Draft">
    <header><div><strong>사람 Draft</strong><span class="badge good">r${currentDraft?.revision ?? 1}</span></div><span class="badge meta-${state}">Meta · ${stateLabel}</span></header>
    <label class="field"><span>사람이 작성한 원문</span><textarea class="prompt-editor" data-scope="local-${kind}" data-field="draft">${esc(item.draft)}</textarea></label>
    <label class="field"><span>Meta Draft · ${state === "stale" ? "이전 사람 Draft 기준" : "실행에 사용할 정제본"}</span><textarea class="prompt-editor meta" data-scope="local-${kind}" data-field="metaDraft" aria-label="Meta Draft">${esc(item.metaDraft ?? "")}</textarea></label>
    <p class="help">Meta Draft를 비워 두면 실행할 때 사람 Draft를 그대로 보냅니다.</p>
    <details class="prompt-history"><summary>Prompt 이력 ${item.promptRevisions.length}</summary><ol>${[...item.promptRevisions].reverse().map((revision) => `<li><span class="badge">${revision.kind === "draft" ? "Draft" : "Meta"} r${revision.revision}</span><span>${revision.status === "current" ? "현재" : "이전"}</span><time>${new Date(revision.createdAt).toLocaleString("ko-KR")}</time></li>`).join("")}</ol></details>
  </section>`;
}

function createLocalTaskFromTodo(todo: LocalTodo): { task: LocalTask; created: boolean } {
  const linked = todo.taskId ? store.tasks.find((item) => item.id === todo.taskId) : undefined;
  if (linked) return { task: linked, created: false };
  const now = new Date().toISOString();
  const taskId = newId("task");
  const revisionIds = new Map(todo.promptRevisions.map((revision) => [revision.id, `${taskId}:${revision.kind}:${crypto.randomUUID()}`]));
  const task: LocalTask = {
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
  view.dirty = true;
  return { task, created: true };
}

/**
 * Task의 대상 프로젝트 편집기.
 *
 * 이전에는 원격 registry를 조회해 다른 장치에 워크트리를 provision까지 했지만,
 * 그 왕복은 패널이 응답을 받을 수 없어 성립하지 않는다. 지금은 `refresh`가 읽어
 * 둔 Orca 프로젝트 목록에서 골라 Task에 붙이고, 다른 편집과 똑같이 저장한다.
 */
function taskProjectSection(task: LocalTask): string {
  const projects = [...(task.projects ?? [])].sort((left, right) => left.position - right.position);
  const targetProjects = projects.filter((project) => project.role === "target" && project.locatorKind === "folder");
  const connected = new Set(projects.map((project) => project.locator));
  const available = targets.projects.filter((project) => project.path && !connected.has(project.path));
  return `<section class="section task-projects"><div class="section-title">대상 프로젝트 · ${targetProjects.length}</div>
    ${projects.length
      ? `<ul class="work-link-list task-project-list">${projects.map((project) => `<li>
          <span><strong>${esc(project.label ?? project.locator.split("/").at(-1) ?? project.locator)}</strong><code>${esc(project.locator)}</code><small>${project.role === "target" ? "대상" : "관련"} · ${project.locatorKind}</small></span>
          <label class="task-project-branch"><span>작업 브랜치</span><input data-scope="task-project-branch" data-task-id="${esc(task.id)}" data-locator="${esc(project.locator)}" value="${esc(project.branch ?? "")}" placeholder="예: feature/task-42"></label>
          <button class="icon danger" data-action="remove-task-project" data-id="${esc(task.id)}" data-locator="${esc(project.locator)}" aria-label="대상 프로젝트 제거">×</button>
        </li>`).join("")}</ul>`
      : '<p class="help">연결된 대상 프로젝트가 없습니다.</p>'}
    <p class="help">실행할 때 이 경로와 작업 브랜치에 일치하는 Orca 워크트리를 우선 선택합니다.</p>
    <label class="field"><span>Orca 프로젝트 추가</span><select data-action="add-task-project" data-id="${esc(task.id)}" ${available.length ? "" : "disabled"}>
      ${option("", available.length ? "프로젝트 선택…" : "추가할 수 있는 프로젝트가 없습니다", "")}
      ${available.map((project) => option(project.path!, `${project.name}${project.branch ? ` · ${shortBranch(project.branch)}` : ""}`, "")).join("")}
    </select></label>
    ${targets.projects.length ? "" : '<p class="help">프로젝트 목록이 비어 있습니다. 도구 모음의 <b>Orca 대상 갱신</b>을 먼저 실행하십시오.</p>'}
  </section>`;
}

function taskInspector(task: LocalTask): string {
  const links = taskGraphLinks(task.id);
  return `<section class="work-detail-page" aria-label="Task 상세">
    <header class="work-detail-header">
      <button class="back-button" data-action="back-to-task-list" aria-label="Task 목록으로 돌아가기">← Task 목록</button>
      <div><span class="badge priority-${task.priority}">${priorityLabel[task.priority]}</span><strong>${esc(task.title)}</strong><small>${esc(task.id)}</small></div>
      <span class="work-detail-actions"><button data-action="open-quick-graph" data-id="${esc(task.id)}" ${task.status === "archived" ? "disabled" : ""}>빠른 그래프 구성</button><button class="primary task-run-button" data-action="open-task-run" data-id="${esc(task.id)}">▶ 실행</button></span>
    </header>
    <div class="work-detail-body">
        <label class="field"><span>제목</span><input data-scope="local-task" data-field="title" value="${esc(task.title)}"></label>
      ${scopeSelectors("local-task", task)}
      ${taskProjectSection(task)}
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
      <p class="help">${dataSource.config.mode === "structured"
        ? "이 원천은 삭제를 지원하지 않아 보관으로 처리하며, 그래프 노드와 Prompt 이력을 유지합니다."
        : "삭제는 이 Task와 Prompt 이력을 저장소에서 지웁니다. 이 Task를 쓰는 그래프 노드는 자기 프롬프트 사본으로 계속 실행됩니다."}</p>
    </div>
  </section>`;
}

function todoInspector(todo: LocalTodo): string {
  const linked = todo.taskId ? store.tasks.find((task) => task.id === todo.taskId) : undefined;
  const archived = Boolean(todo.archivedAt);
  const closed = ["done", "cancelled"].includes(todo.status);
  const busy = busyTodoActions.has(todo.id);
  return `<aside class="work-inspector">
    <header><div><span class="badge priority-${todo.priority}">${priorityLabel[todo.priority]}</span><strong>${esc(todo.title)}</strong>${archived ? '<span class="badge status-archived">보관됨</span>' : ""}</div><small>${esc(todo.id)}</small></header>
    <div class="work-inspector-body">
      <section class="todo-primary-actions" aria-label="ToDo 연결 동작">
        ${linked
          ? `<button class="primary" data-action="open-linked-task" data-id="${esc(linked.id)}">Task 열기</button>`
          : `<button class="primary" data-action="create-task-for-todo" data-id="${esc(todo.id)}" ${archived || closed || busy ? "disabled" : ""}>${busy ? "Task 생성 중…" : "+ Task 생성"}</button>`}
        <button data-action="choose-todo-graph" data-id="${esc(todo.id)}" ${!linked || archived || closed || busy ? "disabled" : ""} title="${linked ? "미리 정의된 워크트리 Graph 선택" : "먼저 Task를 생성하십시오"}">${busy ? "Graph 조회 중…" : "⬡ 워크트리 실행"}</button>
        ${!linked ? '<span class="help">먼저 Task를 생성하십시오.</span>' : ""}
      </section>
      <label class="field"><span>제목</span><input data-scope="local-todo" data-field="title" value="${esc(todo.title)}" ${archived ? "disabled" : ""}></label>
      <div class="field-row"><label class="field"><span>그룹</span><input data-scope="local-todo" data-field="groupName" value="${esc(todo.groupName ?? "")}" aria-label="ToDo 그룹" ${archived ? "disabled" : ""}></label><label class="field"><span>하위그룹 · 선택</span><input data-scope="local-todo" data-field="subgroupName" value="${esc(todo.subgroupName ?? "")}" aria-label="ToDo 하위그룹" ${archived ? "disabled" : ""}></label></div>
      ${scopeSelectors("local-todo", todo)}
      ${promptPairEditor("todo", todo)}
      <label class="field"><span>코멘트 · 선택</span><textarea data-scope="local-todo" data-field="notes" aria-label="ToDo 코멘트" ${archived ? "disabled" : ""}>${esc(todo.notes)}</textarea></label>
      <div class="field-row">
        <label class="field"><span>상태</span><select data-scope="local-todo" data-field="status" ${archived ? "disabled" : ""}>${(Object.entries(todoStatusLabel) as Array<[LocalTodoStatus, string]>).map(([value, label]) => option(value, label, todo.status)).join("")}</select></label>
        <label class="field"><span>우선순위</span><select data-scope="local-todo" data-field="priority" ${archived ? "disabled" : ""}>${(Object.entries(priorityLabel) as Array<[WorkPriority, string]>).map(([value, label]) => option(value, label, todo.priority)).join("")}</select></label>
      </div>
      <label class="field"><span>마감일</span><input type="date" data-scope="local-todo" data-field="dueDate" aria-label="ToDo 마감일" value="${esc(todo.dueDate ?? "")}" ${archived ? "disabled" : ""}></label>
      <label class="field"><span>태그 · 쉼표로 구분</span><input data-scope="local-todo" data-field="tags" value="${esc(todo.tags.join(", "))}" ${archived ? "disabled" : ""}></label>
      <button data-action="toggle-todo-done" data-id="${esc(todo.id)}" ${archived ? "disabled" : ""}>${todo.status === "done" ? "할 일로 되돌리기" : "ToDo 완료"}</button>
      <button data-action="cancel-local-todo" data-id="${esc(todo.id)}" ${archived ? "disabled" : ""}>${todo.status === "cancelled" ? "할 일로 복원" : "ToDo 취소"}</button>
      <p class="help">Task 생성과 Graph 연결은 ${workspaceProductName}의 기존 ToDo↔Task·Graph membership 계약을 사용합니다.</p>
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
      const dispatched = latestDispatch(isTask ? "task" : "todo", item.id);
      const todo = isTask ? undefined : item as LocalTodo;
      const todoBusy = Boolean(todo && busyTodoActions.has(todo.id));
      const todoClosed = Boolean(todo && ["done", "cancelled"].includes(todo.status));
      const todoArchived = Boolean(todo?.archivedAt);
      const actionSurface = isTask
        ? `<button class="quick-worktree-run" data-action="open-task-run" data-id="${esc(item.id)}" aria-label="Task 실행 · ${esc(item.title)}" title="실행" ${item.status === "archived" ? "disabled" : ""}>▶</button>`
        : `<span class="todo-card-actions">
            ${todo!.taskId
              ? `<button data-action="open-linked-task" data-id="${esc(todo!.taskId)}">Task 열기</button>`
              : `<button data-action="create-task-for-todo" data-id="${esc(todo!.id)}" ${todoArchived || todoClosed || todoBusy ? "disabled" : ""}>${todoBusy ? "생성 중…" : "+ Task 생성"}</button>`}
            <button data-action="choose-todo-graph" data-id="${esc(todo!.id)}" aria-label="워크트리 Graph 선택 · ${esc(todo!.title)}" title="${todo!.taskId ? "미리 정의된 워크트리 Graph 선택" : "먼저 Task를 생성하십시오"}" ${!todo!.taskId || todoArchived || todoClosed || todoBusy ? "disabled" : ""}>⬡ 워크트리 실행</button>
            ${!todo!.taskId ? '<small>먼저 Task를 생성하십시오</small>' : ""}
          </span>`;
      return `<div class="work-card-row ${isTask ? "" : "todo-card-row"}"><button class="work-card ${selected ? "selected" : ""}" data-action="${isTask ? "select-local-task" : "select-local-todo"}" data-id="${esc(item.id)}">
        <span class="work-card-head"><span class="work-status-dot status-${esc(item.status)}"></span><strong>${esc(item.title)}</strong>${dispatched ? `<span class="dispatch-inline" title="${esc(new Date(dispatched.dispatchedAt).toLocaleString("ko-KR"))} 세션으로 보냄">↗</span>` : ""}<span class="badge priority-${item.priority}">${priorityLabel[item.priority]}</span></span>
        <span class="work-card-detail">${esc(detail || "Draft 없음")}</span>
        <span class="work-card-meta"><span>${esc(status)}</span><span>${esc(itemScope(item).label)}</span><span class="meta-label meta-${metaState}">Meta ${metaState === "current" ? "최신" : metaState === "running" ? "생성 중" : metaState === "stale" ? "이전본" : metaState === "failed" ? "실패" : "없음"}</span><span>${esc(link)}</span>${item.dueDate ? `<span>마감 ${esc(item.dueDate)}</span>` : ""}</span>
      </button>${actionSurface}${todo?.notes ? `<button class="todo-card-comment" data-action="select-local-todo" data-id="${esc(todo.id)}" ${todoArchived ? "disabled" : ""} aria-label="코멘트 ${todoArchived ? "보기" : "수정"}"><span aria-hidden="true">💬</span><span>${esc(todo.notes)}</span></button>` : ""}</div>`;
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
        <label class="graph-search"><span>⌕</span><input data-action="work-search" value="${esc(view.workQuery)}" ${isTask ? 'placeholder="제목, Draft, Meta, Domain, Milestone 검색"' : ""} aria-label="${kind} 검색"></label>
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

type VisualNodeStatus = GraphNode["status"];

const visualNodeStatusLabel: Record<VisualNodeStatus, string> = {
  pending: "대기",
  running: "실행 중",
  waiting: "승인 대기",
  done: "완료",
  skipped: "건너뜀",
  failed: "실패",
};

/**
 * 노드 상태는 그래프와 run 기록에서만 읽는다. 패널은 세션이 지금 무엇을 하는지
 * 관측할 수 없으므로, 보낸 사실을 진행 중으로 바꿔 표시하지 않는다.
 */
/**
 * 이 그래프를 마지막으로 보낸 기록과, 그 세션이 남긴 노드별 진행.
 *
 * 로컬 저장소에는 원천이 채워 주는 run 기록이 없다. 그 대신 세션 화면에서 읽어 둔
 * 노드 줄이 캔버스가 아는 유일한 진행이다.
 */
function latestGraphDispatch(graphId: string): DispatchRecord | undefined {
  return store.dispatchLog.find((record) => record.itemKind === "graph" && record.itemId === graphId);
}

function observedNodeStates(graphId: string): Record<string, NodeObservation> {
  const record = latestGraphDispatch(graphId);
  if (!record) return {};
  const states: Record<string, NodeObservation> = {};
  for (const target of record.targets) Object.assign(states, target.nodeStates ?? {});
  return states;
}

/**
 * 캔버스 위에 뜨는 실행 배너.
 *
 * 그래프를 보낸 뒤 캔버스가 아무 말도 하지 않으면, 지금 도는 중인지 끝났는지 알 수
 * 없다. 여기 적는 것은 전부 관측한 사실이다 — 언제 어디로 보냈는지, 갱신 때 세션
 * 화면에서 읽은 결과, 그리고 노드를 몇 개나 마쳤다고 그 세션이 남겼는지.
 */
function renderCanvasRunBanner(graph: GraphDefinition): string {
  const record = latestGraphDispatch(graph.id);
  if (!record) return "";
  const status = dispatchRunStatus(record);
  const states = observedNodeStates(graph.id);
  const counted = graph.nodes.filter((node) => states[node.id]).length;
  const failed = graph.nodes.filter((node) => states[node.id]?.status === "failed").length;
  const where = record.targets.map((target) => target.projectName || target.label).join(", ") || "대상 없음";
  return `<div class="canvas-run-banner status-${status}" role="status">
    <span class="run-status-chip ${status}">${runStatusLabels[status]}</span>
    <span class="canvas-run-copy"><strong>${esc(where)}</strong><span>${esc(relativeTime(record.dispatchedAt) || new Date(record.dispatchedAt).toLocaleString("ko-KR"))}에 보냄 · 노드 ${counted}/${graph.nodes.length} 보고${failed ? ` · 실패 ${failed}` : ""}</span></span>
    ${record.targets[0]?.sessionId
      ? `<button class="link" data-action="focus-session" data-id="${esc(record.targets[0].sessionId)}">세션 열기</button>`
      : ""}
    <button class="link" data-action="open-dispatch-detail" data-id="${esc(record.id)}">실행 상세</button>
    <button class="link" data-action="refresh-data">↻ 갱신</button>
  </div>`;
}

function visualNodeStatus(graph: GraphDefinition, node: GraphNode): VisualNodeStatus {
  if (node.status !== "pending") return node.status;
  const result = latestRun(graph)?.nodeResults?.find((item) => item.nodeId === node.id);
  if (result?.status === "failed") return "failed";
  if (result?.status === "done" || result?.status === "skipped") return result.status;
  // 원천이 run을 주지 않는 저장소에서는 세션이 남긴 줄이 유일한 관측이다.
  const observed = observedNodeStates(graph.id)[node.id];
  if (observed) return observed.status;
  return "pending";
}

function nodeExecutionChipMarkup(status: VisualNodeStatus): string {
  return `<span class="node-execution-chip ${status}" title="${esc(visualNodeStatusLabel[status])}"><span class="execution-pulse"></span>${esc(visualNodeStatusLabel[status])}</span>`;
}

const runStatusLabel: Record<GraphRunRecord["status"], string> = {
  running: "진행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
  planned: "계획",
};

function runSeconds(durationMs: number): string {
  return `${Math.round(durationMs / 100) / 10}초`;
}

/** 가장 최근에 이 노드가 실제로 돌았던 run과 그 결과. 최신 run에 기록이 없으면 이전 run까지 거슬러 본다. */
function nodeRunResult(graph: GraphDefinition, node: GraphNode): { run: GraphRunRecord; result: NonNullable<GraphRunRecord["nodeResults"]>[number] } | null {
  for (let index = graph.runs.length - 1; index >= 0; index -= 1) {
    const run = graph.runs[index];
    const result = run?.nodeResults?.find((item) => item.nodeId === node.id);
    if (run && result) return { run, result };
  }
  return null;
}

/**
 * 노드에 올렸을 때 보여 줄 내용.
 *
 * 캔버스의 노드 카드에는 지시문 한 줄만 잘려 들어간다. 무엇을 시키는 노드인지
 * 보려고 매번 편집을 열어야 하면 그래프를 읽을 수 없다.
 */
function nodeHoverCard(graph: GraphDefinition, node: GraphNode): string {
  const status = visualNodeStatus(graph, node);
  const routing = effectiveRouting(graph, node);
  const kindLabel = node.kind === "condition" ? "조건" : node.kind === "graph_call" ? "그래프 호출" : "Task";
  const bodyLabel = node.kind === "condition" ? "조건식" : node.kind === "graph_call" ? "호출할 그래프" : "지시문";
  const body = node.kind === "condition"
    ? node.conditionExpr || "조건을 입력하십시오"
    : node.kind === "graph_call"
      ? store.graphs.find((item) => item.id === node.childGraphId)?.name ?? "호출할 그래프를 선택하십시오"
      : node.task?.prompt || "Task 지시문을 입력하십시오";
  const where = routing.sessionId
    ? `기존 세션 · ${sessionName(routing.sessionId, routing.environmentId)}`
    : routing.projectId
      ? `${projectName(routing.projectId, routing.environmentId)}${routing.branch ? ` · ${shortBranch(routing.branch)}` : ""}`
      : "현재 Orca 컨텍스트";
  const found = nodeRunResult(graph, node);
  return `<div class="node-hover-head">
      <span class="execution-kind">${kindLabel}</span>
      <strong>${esc(nodeDisplayTitle(node))}</strong>
      <span class="node-hover-status status-${status}">${esc(visualNodeStatusLabel[status])}</span>
    </div>
    <div class="node-hover-meta">${esc(where)} · ${esc(modelName(routing.model))}${routing.reasoning ? ` · ${esc(routing.reasoning)}` : ""}</div>
    <div class="node-hover-label">${bodyLabel}</div>
    <pre class="node-hover-body">${esc(body)}</pre>
    ${found
      ? `<div class="node-hover-label">최근 실행 · Run #${found.run.runNo}</div>
         <div class="node-hover-meta">${esc(visualNodeStatusLabel[found.result.status])}${found.result.attempt ? ` · 시도 ${found.result.attempt}회` : ""}${found.result.durationMs ? ` · ${esc(runSeconds(found.result.durationMs))}` : ""}${found.result.sessionTitle || found.result.sessionId ? ` · 세션 ${esc(found.result.sessionTitle || found.result.sessionId || "")}` : ""}</div>
         ${found.result.message ? `<pre class="node-hover-body ${found.result.status === "failed" ? "failed" : ""}">${esc(found.result.message.slice(0, 1_200))}</pre>` : ""}`
      : '<div class="node-hover-meta">이 노드의 실행 기록이 아직 없습니다.</div>'}`;
}

function nodeRunTooltip(graph: GraphDefinition, node: GraphNode, status: VisualNodeStatus): string {
  const found = nodeRunResult(graph, node);
  const lines = [`${nodeDisplayTitle(node)} · ${visualNodeStatusLabel[status]}`];
  if (!found) {
    lines.push("이 노드의 실행 기록이 아직 없습니다.");
    return lines.join("\n");
  }
  const { run, result } = found;
  lines.push(`Run #${run.runNo} · ${runStatusLabel[run.status]}`);
  const meta = [
    result.attempt ? `시도 ${result.attempt}회` : "",
    result.durationMs ? runSeconds(result.durationMs) : "",
    result.endedAt ? new Date(result.endedAt).toLocaleString("ko-KR") : "",
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  if (result.sessionTitle || result.sessionId) lines.push(`세션 ${result.sessionTitle || result.sessionId}`);
  if (result.message) lines.push("", result.status === "failed" ? `실패 사유\n${result.message.slice(0, 1_500)}` : result.message.slice(0, 1_500));
  return lines.join("\n");
}

function nodeRunMetaMarkup(graph: GraphDefinition, node: GraphNode, status: VisualNodeStatus): string {
  const result = nodeRunResult(graph, node)?.result;
  if (!result) return "";
  return `<div class="node-run-meta status-${status}"><strong>${esc(visualNodeStatusLabel[status])}</strong>${result.attempt ? `<span>시도 ${result.attempt}</span>` : ""}${result.durationMs ? `<span>${esc(runSeconds(result.durationMs))}</span>` : ""}${result.message ? `<span class="node-run-message" title="${esc(result.message)}">${esc(result.message)}</span>` : ""}</div>`;
}

/* ── 실행 현황 ────────────────────────────────────────────────────────────────
 *
 * 패널이 하는 일은 Orca 세션에 프롬프트를 꽂는 것까지다. 그 뒤 진행은 세션의
 * 에이전트가 소유하고, 패널에는 되돌아오는 채널이 없다. 그래서 이 화면은 두 가지
 * 사실만 보여 준다.
 *
 *   1. 패널이 무엇을 어디로 언제 보냈는가 (dispatch 로그)
 *   2. 그래프에 기록된 run 이력 (원천이 알려 준 것)
 *
 * 진행률을 추정하거나 확인하지 못한 상태를 지어내지 않는다.
 */

/**
 * 보낸 대상 하나의 지금 상태.
 *
 * 패널에는 세션에서 돌아오는 채널이 없다. 대신 `refresh`가 읽어 둔 Orca 세션 목록과
 * 대조한다 — 살아 있는지, 에이전트가 무엇을 하고 있다고 Orca가 보고했는지, 그 세션
 * 화면의 마지막 줄은 무엇인지. 전부 갱신 시각 기준의 관측이고, 진행률처럼 확인하지
 * 못한 값은 만들지 않는다.
 */
type DispatchTargetState = {
  tone: "live" | "idle" | "gone" | "unknown";
  label: string;
  session?: SessionTarget;
};

function dispatchTargetState(target: DispatchTarget): DispatchTargetState {
  if (!target.sessionId) return { tone: "unknown", label: "세션 미확인" };
  const session = targets.sessions.find((item) => item.id === target.sessionId);
  if (!session) return { tone: "gone", label: "닫힘" };
  if (!session.connected) return { tone: "gone", label: "연결 끊김", session };
  const state = String(session.agentState || "").toLowerCase();
  if (state === "working" || state === "running") return { tone: "live", label: "작업 중", session };
  if (state === "done" || state === "idle" || state === "ready") return { tone: "idle", label: "대기", session };
  return { tone: "unknown", label: session.agentState || "상태 미확인", session };
}

function relativeTime(value: string | undefined): string {
  if (!value) return "";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function dispatchTargetLine(target: DispatchTarget): string {
  const state = dispatchTargetState(target);
  const where = [target.projectName || target.label, target.branch].filter(Boolean).join(" · ");
  const session = state.session?.title
    || target.sessionTitle
    || (target.opened === "new-session" ? "새 세션" : target.sessionId?.slice(0, 16) || "세션");
  return `<div class="dispatch-target tone-${state.tone}">
    <div class="dispatch-target-head">
      <span class="dispatch-state ${state.tone}">${esc(state.label)}</span>
      <strong>${esc(where || "대상")}</strong>
      <span class="dispatch-session" title="${esc(target.sessionId ?? "")}">${esc(session)}${target.model ? ` · ${esc(modelName(target.model))}` : ""}</span>
      ${targetOutcomeLabel(target)
        ? `<span class="dispatch-outcome ${esc(target.outcome?.status ?? "running")}">${esc(targetOutcomeLabel(target))}</span>`
        : ""}
      ${target.readyConfirmed === false
        ? '<span class="badge warn" title="tui-idle 신호를 받지 못한 채 보냈습니다. 세션이 받았는지 화면으로 확인하십시오.">준비 확인 없음</span>'
        : ""}
      ${target.sessionId
        ? `<button class="link" data-action="focus-session" data-id="${esc(target.sessionId)}">세션 열기</button>`
        : ""}
    </div>
    ${state.session?.preview
      ? `<p class="dispatch-preview" title="${esc(state.session.preview)}">${esc(state.session.preview)}${state.session.lastOutputAt ? ` · ${esc(relativeTime(state.session.lastOutputAt))}` : ""}</p>`
      : ""}
  </div>`;
}

/**
 * 실행 하나의 상태.
 *
 * 세션이 남긴 결과 줄(`RESULT: done` / `RESULT: failed`)을 갱신 때 읽어 둔 것이
 * 근거다. 아직 결과가 없고 세션이 살아 있으면 진행 중, 결과 없이 세션이 사라졌으면
 * 실패로 본다 — 결과를 남기라는 것이 프롬프트가 요구한 계약이기 때문이다.
 */
type RunStatus = "running" | "done" | "failed";

function dispatchRunStatus(record: DispatchRecord): RunStatus {
  if (record.error && !record.targets.length) return "failed";
  const outcomes = record.targets.map((target) => target.outcome?.status ?? "running");
  if (record.error || outcomes.includes("failed") || outcomes.includes("closed")) return "failed";
  if (outcomes.length && outcomes.every((status) => status === "done")) return "done";
  return "running";
}

const runStatusLabels: Record<RunStatus, string> = { running: "진행중", done: "성공", failed: "실패" };

/** 이 대상이 남긴 결과 한 줄. 없으면 빈 문자열. */
function targetOutcomeLabel(target: DispatchTarget): string {
  const outcome = target.outcome;
  if (!outcome) return "";
  if (outcome.status === "done") return "성공";
  if (outcome.status === "failed") return `실패${outcome.message ? ` · ${outcome.message}` : ""}`;
  if (outcome.status === "closed") return "결과 없이 종료";
  return "진행중";
}

/** 같은 항목의 실행은 한 묶음으로 본다. 보낼 때마다 카드가 쌓이면 최신을 못 찾는다. */
/** 이 실행 한 건을 한 줄로. 이력에서 최신순으로 쌓인다. */
function renderDispatchRun(record: DispatchRecord, index: number): string {
  const status = dispatchRunStatus(record);
  return `<li class="dispatch-run status-${status}">
    <div class="dispatch-run-head">
      <span class="run-status-chip ${status}">${runStatusLabels[status]}</span>
      <time title="${esc(new Date(record.dispatchedAt).toLocaleString("ko-KR"))}">${esc(new Date(record.dispatchedAt).toLocaleString("ko-KR"))}</time>
      ${index === 0 ? '<span class="badge">최신</span>' : ""}
      <span class="dispatch-run-where">${esc(record.targets.map((target) => target.projectName || target.label).join(", ") || "대상 없음")}</span>
      <button class="link" data-action="open-dispatch-detail" data-id="${esc(record.id)}">상세</button>
      <button class="link danger" data-action="delete-dispatch-record" data-id="${esc(record.id)}">삭제</button>
    </div>
    ${record.error ? `<p class="dispatch-error" role="alert">${esc(record.error)}</p>` : ""}
  </li>`;
}

/**
 * 한 항목의 실행 이력.
 *
 * 실행은 같은 Task·Graph에 계속 쌓인다. 카드 하나로 묶고, 펼치면 그 항목의 이력이
 * 최신순으로 전부 보인다. 이력은 이 장치에서 관측한 기록일 뿐이므로 지울 수 있다 —
 * 한 건씩도, 그 항목 전체도.
 */
function renderDispatchGroup(records: DispatchRecord[]): string {
  const latest = records[0]!;
  const kindLabel = latest.itemKind === "graph" ? "Graph" : latest.itemKind === "task" ? "Task" : "Todo";
  const groupKey = `${latest.itemKind}:${latest.itemId}`;
  const expanded = view.expandedExecutionItems.has(groupKey);
  const status = dispatchRunStatus(latest);
  return `<article class="dispatch-card ${latest.error ? "failed" : ""}">
    <header data-action="toggle-execution-history" data-id="${esc(groupKey)}" role="button" tabindex="0" aria-expanded="${expanded ? "true" : "false"}" aria-label="${esc(latest.title)} 실행 이력 ${expanded ? "접기" : "펼치기"}">
      <span class="dispatch-twisty" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
      <span class="execution-kind">${kindLabel}</span>
      <div><strong>${esc(latest.title)}</strong><small>${esc(latest.itemId)}</small></div>
      <span class="run-status-chip ${status}">${runStatusLabels[status]}</span>
      <time title="${esc(new Date(latest.dispatchedAt).toLocaleString("ko-KR"))}">${esc(relativeTime(latest.dispatchedAt) || new Date(latest.dispatchedAt).toLocaleString("ko-KR"))}</time>
    </header>
    ${latest.error ? `<p class="dispatch-error" role="alert">세션에 전달하지 못했습니다 · ${esc(latest.error)}</p>` : ""}
    ${latest.targets.length
      ? `<div class="dispatch-targets">${latest.targets.map(dispatchTargetLine).join("")}</div>`
      : ""}
    ${expanded
      ? `<ol class="dispatch-runs" aria-label="${esc(latest.title)} 실행 이력">${records.map(renderDispatchRun).join("")}</ol>`
      : ""}
    <footer>
      <span class="dispatch-card-actions">
        <button data-action="open-dispatch-detail" data-id="${esc(latest.id)}">최근 실행 상세</button>
        <button data-action="open-execution-item" data-kind="${latest.itemKind}" data-id="${esc(latest.itemId)}">${kindLabel} 열기</button>
      </span>
      <span class="dispatch-card-actions">
        <button data-action="toggle-execution-history" data-id="${esc(groupKey)}">실행 이력 ${records.length}건 ${expanded ? "접기" : "펼치기"}</button>
        <button class="danger" data-action="delete-dispatch-item" data-kind="${latest.itemKind}" data-id="${esc(latest.itemId)}">이력 삭제</button>
      </span>
    </footer>
  </article>`;
}

/** 그래프에 기록된 run 이력. 원천이 노드별 결과를 주면 그것까지 펼친다. */
function renderGraphRunTimeline(graphId: string): string {
  const graph = store.graphs.find((item) => item.id === graphId);
  if (!graph) return "";
  const runs = [...graph.runs].reverse().slice(0, 5);
  if (!runs.length) return '<p class="run-timeline-empty">아직 기록된 run이 없습니다.</p>';
  const nodeLabel = (nodeId: string): string => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    return node ? nodeDisplayTitle(node) : nodeId;
  };
  return `<div class="run-timeline">${runs.map((run, index) => {
    const results = run.nodeResults ?? [];
    const counts = {
      done: results.filter((item) => item.status === "done").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
    };
    return `<details class="run-entry run-status-${run.status}" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="run-no">Run #${run.runNo}</span>
        <span class="run-status-chip ${run.status}">${esc(runStatusLabel[run.status])}</span>
        <span class="run-counts">완료 ${counts.done}${counts.skipped ? ` · 건너뜀 ${counts.skipped}` : ""}${counts.failed ? ` · 실패 ${counts.failed}` : ""} / 노드 ${graph.nodes.length}</span>
        <time>${esc(new Date(run.startedAt).toLocaleString("ko-KR"))}</time>
      </summary>
      ${run.inputPrompt ? `<div class="run-input"><strong>이번 run 업무 입력</strong><p>${esc(run.inputPrompt)}</p></div>` : ""}
      ${run.terminationReason && run.terminationReason !== "completed" ? `<p class="run-termination">종료 사유 · ${esc(run.terminationReason)}</p>` : ""}
      ${results.length
        ? `<ol class="run-nodes">${results.map((result) => `<li class="run-node status-${result.status}">
            <span class="run-node-status">${esc(visualNodeStatusLabel[result.status])}</span>
            <div class="run-node-body">
              <strong>${esc(nodeLabel(result.nodeId))}</strong>
              <span class="run-node-meta">${[
                result.attempt ? `시도 ${result.attempt}` : "",
                result.durationMs ? runSeconds(result.durationMs) : "",
                result.endedAt ? new Date(result.endedAt).toLocaleTimeString("ko-KR") : "",
                result.sessionTitle || result.sessionId ? `세션 ${result.sessionTitle || result.sessionId}` : "",
              ].filter(Boolean).map((part) => `<span>${esc(part)}</span>`).join("")}</span>
              ${result.message ? `<pre class="run-node-message ${result.status === "failed" ? "failed" : ""}">${esc(result.message)}</pre>` : ""}
            </div>
          </li>`).join("")}</ol>`
        : '<p class="run-nodes-empty">이 run에는 노드별 기록이 없습니다. 세션이 아직 진행 중이거나, 원천이 노드별 결과를 남기지 않았습니다.</p>'}
    </details>`;
  }).join("")}</div>`;
}

function renderExecutionManager(): string {
  const records = store.dispatchLog;
  // 같은 Task·Graph를 여러 번 보내면 카드가 그만큼 쌓인다. 항목별로 묶고 최신을 앞에 둔다.
  const byItem = new Map<string, DispatchRecord[]>();
  for (const record of records) {
    const key = `${record.itemKind}:${record.itemId}`;
    byItem.set(key, [...(byItem.get(key) ?? []), record]);
  }
  const groups = [...byItem.values()]
    .map((entries) => [...entries].sort((left, right) => right.dispatchedAt.localeCompare(left.dispatchedAt)))
    .sort((left, right) => right[0]!.dispatchedAt.localeCompare(left[0]!.dispatchedAt));
  const dispatchedGraphIds = [...new Set(records.filter((record) => record.itemKind === "graph").map((record) => record.itemId))];
  return `<section class="execution-manager" aria-label="실행 현황">
    <header class="execution-manager-header">
      <div><strong>실행 현황</strong><span>${(["running", "done", "failed"] as RunStatus[])
        .map((status) => `${runStatusLabels[status]} ${groups.filter((entries) => dispatchRunStatus(entries[0]!) === status).length}`)
        .join(" · ")}</span></div>
      <button data-action="refresh-data" aria-label="데이터 다시 읽기">↻ 다시 읽기</button>
    </header>
    <p class="help execution-scope-note">패널은 Orca 세션에 작업을 전달하는 데까지 관여합니다. 전달 뒤의 진행은 각 세션에서 확인하십시오.</p>
    <div class="execution-manager-body">
      ${records.length
        ? (["running", "done", "failed"] as RunStatus[]).map((status) => {
            const bucket = groups.filter((entries) => dispatchRunStatus(entries[0]!) === status);
            if (!bucket.length) return "";
            return `<section class="execution-section status-${status}"><header><strong>${runStatusLabels[status]}</strong><span>${bucket.length}건</span></header>
              <div class="dispatch-list">${bucket.map(renderDispatchGroup).join("")}</div>
            </section>`;
          }).join("")
        : '<div class="execution-empty"><strong>보낸 작업이 없습니다.</strong><span>Task 또는 Graph의 실행 버튼에서 세션으로 작업을 보낼 수 있습니다.</span></div>'}
      ${dispatchedGraphIds.length
        ? `<section class="execution-section"><header><strong>Graph run 이력</strong><span>원천에 기록된 실행</span></header>
            ${dispatchedGraphIds.map((graphId) => {
              const graph = store.graphs.find((item) => item.id === graphId);
              if (!graph) return "";
              return `<article class="execution-group"><header class="execution-group-header"><span class="execution-kind">Graph</span><div><strong>${esc(graph.name)}</strong><small>${esc(graph.id)}</small></div><button data-action="open-execution-item" data-kind="graph" data-id="${esc(graph.id)}">Graph 열기</button></header>${renderGraphRunTimeline(graphId)}</article>`;
            }).join("")}
          </section>`
        : ""}
    </div>
  </section>`;
}


function renderSectionNav(): string {
  return `<nav class="section-tabs" aria-label="플러그인 메뉴">
    <button class="${view.mode === "list" ? "active" : ""}" data-action="set-view" data-id="list">그래프 목록</button>
    <button class="${view.mode === "canvas" ? "active" : ""}" data-action="set-view" data-id="canvas">그래프 보기</button>
    <button class="${view.mode === "executions" ? "active" : ""}" data-action="set-view" data-id="executions">실행 현황${store.dispatchLog.length ? ` <span class="nav-count">${store.dispatchLog.length}</span>` : ""}</button>
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
  // 다시 그리면 노드 요소가 바뀐다. 떠 있던 카드는 이전 좌표를 가리키므로 치운다.
  hideNodeHover();
  const graph = activeGraph();
  const runCount = graph.runs.length;
  const previousSemanticFocus = returnFocusFor(document.activeElement);
  const previousDialog = app.querySelector<HTMLElement>('[role="dialog"]');
  const previousFocusables = previousDialog ? focusableElements(previousDialog) : [];
  const previousFocusIndex = previousFocusables.indexOf(document.activeElement as HTMLElement);
  app.innerHTML = `<div class="app-shell mode-${view.editorMode}">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">⌘</span><span class="brand-copy"><strong>Graph Engineering</strong><small>Orca-native execution graph</small></span></div>
      <select class="graph-switcher" data-action="switch-graph" aria-label="그래프 선택">${graphOptions(graph.id)}</select>
      <button class="icon always" data-action="new-graph" title="새 그래프">＋</button>
      <button class="icon" data-action="clone-graph" title="그래프 복제">⧉</button>
      <span class="topbar-spacer"></span>
      ${view.dirty ? '<span class="status-pill warn" role="status" aria-live="polite"><span class="dirty-dot"></span>저장 안 됨</span>' : '<span class="status-pill good" role="status" aria-live="polite">저장됨</span>'}
      <button class="ghost" data-action="open-data-source" title="그래프 데이터 원천 설정">데이터 원천</button>
      <button class="ghost" data-action="refresh-source" title="연결된 데이터 원천에서 최신 snapshot 가져오기" aria-label="데이터 원천 새로고침" aria-busy="${view.sourceRefreshing}" ${dataSource.config.mode === "local" || view.sourceRefreshing ? "disabled" : ""}>${view.sourceRefreshing ? "새로고침 중…" : "새로고침"}</button>
      ${view.mode === "canvas" ? '<button class="primary always topbar-run" data-action="open-run" title="그래프 실행">▶ 실행</button>' : ""}
      <button class="primary always" data-action="save">저장</button>
    </header>
    ${renderSectionNav()}
    ${view.mode === "list" ? `<div class="workspace list-mode">${renderGraphList()}</div>` : view.mode === "executions" ? `<div class="workspace list-mode">${renderExecutionManager()}</div>` : view.mode === "domains" ? `<div class="workspace list-mode">${renderScopeManager("domain")}</div>` : view.mode === "milestones" ? `<div class="workspace list-mode">${renderScopeManager("milestone")}</div>` : view.mode === "tasks" ? `<div class="workspace list-mode">${renderLocalWorkManager("task")}</div>` : view.mode === "todos" ? `<div class="workspace list-mode">${renderLocalWorkManager("todo")}</div>` : `<div class="workspace ${view.inspectorOpen ? "" : "inspector-closed"}">
      <section class="editor">
        ${renderGraphTrail()}
        <nav class="toolbar" aria-label="그래프 도구">
          <span class="toolbar-desktop">
            <span class="toolbar-group editor-mode-toggle"><button class="${view.editorMode === "design" ? "active" : ""}" data-action="editor-mode" data-id="design">설계</button><button class="${view.editorMode === "run" ? "active" : ""}" data-action="editor-mode" data-id="run">실행 보기</button></span>
            <span class="toolbar-group"><button data-action="add-task">＋ Task</button><button data-action="open-batch-tasks">＋ Task 묶음</button><button data-action="add-condition">＋ ◇ 조건</button><button data-action="add-graph-call">＋ ▦ 호출</button></span>
            <span class="toolbar-group"><button data-action="undo" ${view.historyUndo.length ? "" : "disabled"}>↶</button><button data-action="redo" ${view.historyRedo.length ? "" : "disabled"}>↷</button><button data-action="open-templates">Topology</button><button data-action="auto-layout">자동 정렬 미리보기 ${view.layoutDirection}</button><button data-action="toggle-layout">${view.layoutDirection === "LR" ? "가로 → 세로" : "세로 → 가로"}</button></span>
            <span class="toolbar-group"><label class="node-search"><span>⌕</span><input data-action="node-search" value="${esc(view.nodeQuery)}" placeholder="노드 검색 ⌘K" aria-label="노드 검색"></label><select data-action="group-mode" aria-label="캔버스 그룹">${option("none", "그룹 없음", graphGroupMode(graph))}${option("domain", "Domain", graphGroupMode(graph))}${option("milestone", "Milestone", graphGroupMode(graph))}${option("superstep", "Superstep", graphGroupMode(graph))}${option("loop", "Loop", graphGroupMode(graph))}</select></span>
            <span class="toolbar-group"><button data-action="refresh-targets">Orca 대상 갱신</button><button data-action="reset-graph-history" title="노드와 연결은 그대로 두고 실행 상태만 되돌립니다">↺ 실행 초기화</button></span>
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
                <button data-action="reset-graph-history">↺ 실행 초기화</button>
                <button data-action="show-analysis">그래프 설정</button>
                <button data-action="toggle-problems">Problems</button>
                <button data-action="open-data-source">데이터 원천</button>
                <button data-action="refresh-targets">Orca 대상 갱신</button>
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
      <span class="message">${esc(store.lastSaveMessage ?? "그래프를 편집한 뒤 저장하십시오.")}</span>
      <span class="status-pill ${dataSource.status === "ready" ? "good" : dataSource.status === "error" ? "bad" : "warn"}">${esc(dataSource.config.mode)} · ${esc(dataSource.status)}</span>
      <span>${targets.environments?.length ?? 1} environments · ${targets.projects.length} projects · ${targets.sessions.length} sessions · built ${new Date(bootstrap.builtAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
    </footer>
    ${renderModal()}
    ${toastMarkup()}
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

/**
 * Task 몇 개를 순서대로 잇는 그래프를 만든다.
 *
 * 예전에는 원천의 quick-create 경계를 호출했지만, 그 왕복은 응답 채널이 없어
 * 성립하지 않는다. 지금은 다른 편집과 똑같이 로컬에서 만들고 저장할 때 원천에
 * 커밋한다.
 */
function createQuickGraphLocally(source: LocalTask, name: string, taskIds: string[]): void {
  const now = new Date().toISOString();
  const ordered = [source.id, ...taskIds.filter((id) => id !== source.id)];
  const graphId = newId("graph");
  const nodes: GraphNode[] = ordered.flatMap((taskId, index) => {
    const task = store.tasks.find((item) => item.id === taskId);
    if (!task) return [];
    return [{
      id: newId("NODE"),
      kind: "task",
      label: task.title,
      x: 48 + index * 270,
      y: 48,
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
    } satisfies GraphNode];
  });
  const edges = nodes.slice(1).map((node, index) => ({
    id: newId("EDGE"),
    from: nodes[index]!.id,
    to: node.id,
    kind: "sequence" as const,
  }));
  store.graphs.push({
    id: graphId,
    name: name || `${source.title} 그래프`,
    summary: "",
    status: "draft",
    version: dataSource.config.mode === "structured" ? 0 : 1,
    pinned: false, processEnabled: false, routineEnabled: false, repeatMode: "none",
    defaults: {},
    runGuards: { claimLeaseSeconds: 21600, stagnationRuns: 3 },
    engineering: { checkpointPolicy: "superstep", requireProvenance: true, humanGateForIrreversible: true, maturity: "experimental" },
    nodes, edges, runs: [], createdAt: now, updatedAt: now,
  });
  store.activeGraphId = graphId;
  view.mode = "canvas";
  view.graphTrail = [];
  clearGraphSelection();
  view.dirty = true;
  render();
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

/* ── 터미널 채널 ──────────────────────────────────────────────────────────────
 *
 * 패널이 밖으로 나갈 수 있는 유일한 호스트 액션은 `terminal.sendText`이고, 한 번에
 * 4096자까지, 10초에 30번까지 보낼 수 있다. 그래서 긴 텍스트는 `enter: false`로
 * 이어 붙여 한 줄을 완성한 뒤 마지막에만 Enter를 보낸다. 응답을 받을 방법은 없다.
 */

const TERMINAL_TEXT_LIMIT = 4_000;
const TERMINAL_TEXT_TOTAL_LIMIT = 96 * 1024;

async function sendTerminalLine(terminalId: string, text: string): Promise<void> {
  if (text.length > TERMINAL_TEXT_TOTAL_LIMIT) {
    throw new Error("보낼 내용이 한 번에 터미널로 전달할 수 있는 크기를 넘었습니다. 나누어 저장하거나 실행하십시오.");
  }
  // 줄에 남아 있을지 모르는 입력을 먼저 지운다. 남은 문자가 앞에 붙으면 명령이
  // 통째로 다른 뜻이 된다.
  await hostCall("terminal.sendText", { terminalId, text: "", enter: false });
  for (let offset = 0; offset < text.length; offset += TERMINAL_TEXT_LIMIT) {
    const chunk = text.slice(offset, offset + TERMINAL_TEXT_LIMIT);
    const last = offset + TERMINAL_TEXT_LIMIT >= text.length;
    await hostCall("terminal.sendText", { terminalId, text: chunk, enter: last });
  }
}

/** JSON을 gzip + base64url로 만든다. 압축하지 않으면 Task 하나도 한 줄에 못 담는다. */
async function encodePayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const compressed = new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  let binary = "";
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function currentTerminals(): Promise<Array<{ id: string }>> {
  const context = await hostCall<WorkspaceContext>("workspace.readContext", {});
  return context?.terminals ?? [];
}

/**
 * 이 터미널에서 에이전트가 돌고 있으면 그 세션. Orca가 패널에 알려주는 터미널
 * id는 `refresh`가 읽어 둔 세션 handle과 같은 값이라, 어느 pane이 작업을 받는
 * 에이전트인지 여기서 알 수 있다.
 */
function agentSessionForTerminal(terminalId: string) {
  return targets.sessions.find((session) => session.id === terminalId);
}

/**
 * 저장·실행 명령을 보낼 터미널.
 *
 * 이 플러그인은 자기 전용 터미널(탭 이름 `Graph Engineering`)을 쓴다. 그 터미널은
 * 설치할 때와 CLI가 돌 때마다 확보되고, handle이 이 장치의 store에 남아 패널
 * bootstrap으로 들어온다. 그래서 평소에는 아무것도 묻지 않는다.
 *
 * 아직 그 터미널이 없는 워크트리에서는 에이전트가 돌지 않는 터미널 하나를 골라
 * 한 번 보낸다. 그 명령이 도는 동안 CLI가 이 워크트리의 전용 터미널을 만들어
 * 두므로, 다음 저장부터는 그쪽으로 간다.
 */
async function resolveSaveTerminal(): Promise<string> {
  const terminals = await currentTerminals();
  if (!terminals.length) {
    throw new Error("이 워크트리에 열린 터미널이 없습니다. Orca에서 터미널 탭을 하나 열어 주십시오.");
  }
  const remembered = store.saveTerminalId;
  if (remembered && terminals.some((terminal) => terminal.id === remembered)) return remembered;
  // 에이전트가 도는 pane에 보낸 명령은 셸이 아니라 그 에이전트의 입력이 된다.
  const shell = terminals.find((terminal) => !agentSessionForTerminal(terminal.id));
  if (!shell) {
    throw new Error("이 워크트리에는 에이전트 세션만 열려 있습니다 — 그 터미널은 작업을 받는 쪽이라 보내지 않습니다. 터미널 탭을 하나 열어 주십시오.");
  }
  store.saveTerminalId = shell.id;
  return shell.id;
}

/* ── 터미널이 없을 때 ─────────────────────────────────────────────────────────
 *
 * 패널은 터미널을 만들 수 없다. 호스트가 sandbox 패널에 여는 것은
 * `workspace.readContext`·`terminal.sendText`·`notifications.show` 셋뿐이고,
 * 나머지는 `panel: false`다. 그래서 이 워크트리에 쓸 수 있는 터미널이 하나도 없는
 * 순간에는 보낼 방법이 없다.
 *
 * 그때 명령을 버리지 않고 들고 있다가, 터미널이 생기면 사람이 다시 누르지 않아도
 * 이어서 보낸다. 사용자가 할 일은 터미널 탭을 하나 여는 것뿐이고, 그 다음은
 * CLI가 전용 터미널을 만들어 가져간다.
 */

const PENDING_POLL_MS = 2_000;
const PENDING_GIVE_UP_MS = 10 * 60 * 1000;

let pendingCommandLines: string[] = [];
let pendingTimer = 0;
let pendingUntil = 0;

function stopPendingWatch(): void {
  if (pendingTimer) window.clearInterval(pendingTimer);
  pendingTimer = 0;
}

async function flushPendingCommands(): Promise<void> {
  if (!pendingCommandLines.length) {
    stopPendingWatch();
    return;
  }
  if (Date.now() > pendingUntil) {
    stopPendingWatch();
    const dropped = pendingCommandLines.length;
    pendingCommandLines = [];
    toast(`터미널이 열리지 않아 대기하던 명령 ${dropped}건을 취소했습니다. 터미널 탭을 연 뒤 다시 시도하십시오.`);
    return;
  }
  let terminalId: string;
  try {
    terminalId = await resolveSaveTerminal();
  } catch {
    return;
  }
  stopPendingWatch();
  const lines = pendingCommandLines;
  pendingCommandLines = [];
  for (const line of lines) await sendTerminalLine(terminalId, line);
  toast(`터미널이 열려 대기하던 명령 ${lines.length}건을 이어서 보냈습니다.`);
}

/** 터미널이 생길 때까지 기다렸다가 보낸다. 폴링은 sandbox 안에서만 돈다. */
function watchForTerminal(line: string): void {
  pendingCommandLines.push(line);
  pendingUntil = Date.now() + PENDING_GIVE_UP_MS;
  if (pendingTimer) return;
  pendingTimer = window.setInterval(() => void flushPendingCommands(), PENDING_POLL_MS);
  void hostCall("notifications.show", {
    title: "Graph Engineering",
    body: "보낼 터미널이 없습니다. Orca에서 터미널 탭을 하나 열면 대기 중인 저장·실행을 이어서 보냅니다.",
  }).catch(() => {});
}

type StoreCommand = { command: "save" | "dispatch" | "source" | "refresh" | "focus"; payload?: unknown };

/**
 * 저장 CLI를 부르는 한 줄을 만든다. 상주 프로세스가 아니라 호출당 한 번 돌고 끝난다.
 *
 * 여러 명령은 반드시 한 줄로 이어 붙인다. 앞 명령이 도는 동안 다음 줄을 타이핑하면
 * 그 입력은 셸의 zle이 아니라 tty의 정규 모드 버퍼로 들어가는데, macOS의 그 버퍼는
 * 1024바이트라 긴 payload가 소리 없이 잘린다 — 잘린 줄은 셸 문법 오류가 되고 실행은
 * 일어나지 않는다. `&&`로 묶으면 셸이 idle일 때 한 번만 타이핑하므로 잘리지 않고,
 * 저장이 실패하면 실행도 가지 않는다.
 */
async function storeCommandLine(commands: StoreCommand[]): Promise<string> {
  const script = `${bootstrap.pluginRoot}/scripts/graph-store.mjs`;
  const parts = await Promise.all(commands.map(async ({ command, payload }) => {
    // focus는 터미널 handle 하나만 받는다. 나머지는 gzip+base64url payload다.
    const argument = payload === undefined ? ""
      : command === "focus" ? ` ${JSON.stringify(String(payload))}`
        : ` ${await encodePayload(payload)}`;
    return `node ${JSON.stringify(script)} ${command}${argument}`;
  }));
  return parts.join(" && ");
}

async function runStoreCommands(commands: StoreCommand[]): Promise<void> {
  if (!commands.length) return;
  const line = await storeCommandLine(commands);
  let terminalId: string;
  try {
    terminalId = await resolveSaveTerminal();
  } catch (error) {
    watchForTerminal(line);
    throw new Error(`${error instanceof Error ? error.message : String(error)} 터미널이 열리면 이 명령을 자동으로 이어서 보냅니다.`);
  }
  await sendTerminalLine(terminalId, line);
}

async function runStoreCommand(command: StoreCommand["command"], payload?: unknown): Promise<void> {
  await runStoreCommands([payload === undefined ? { command } : { command, payload }]);
}

function elementFromMarkup(markup: string): HTMLElement | null {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild as HTMLElement | null;
}

function morphElement(current: Element, fresh: Element): void {
  for (const name of current.getAttributeNames()) if (!fresh.hasAttribute(name)) current.removeAttribute(name);
  for (const name of fresh.getAttributeNames()) {
    const value = fresh.getAttribute(name) ?? "";
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
  const currentChildren = [...current.childNodes];
  const freshChildren = [...fresh.childNodes];
  for (let index = 0; index < Math.max(currentChildren.length, freshChildren.length); index += 1) {
    const currentChild = currentChildren[index];
    const freshChild = freshChildren[index];
    if (!freshChild) {
      currentChild?.remove();
      continue;
    }
    if (!currentChild) {
      current.append(freshChild.cloneNode(true));
      continue;
    }
    if (currentChild.nodeType === Node.TEXT_NODE && freshChild.nodeType === Node.TEXT_NODE) {
      if (currentChild.nodeValue !== freshChild.nodeValue) currentChild.nodeValue = freshChild.nodeValue;
      continue;
    }
    if (currentChild instanceof Element && freshChild instanceof Element && currentChild.tagName === freshChild.tagName) {
      morphElement(currentChild, freshChild);
      continue;
    }
    currentChild.replaceWith(freshChild.cloneNode(true));
  }
}

function patchCanvasExecution(graph: GraphDefinition): void {
  const canvas = app.querySelector<HTMLElement>("[data-canvas]");
  if (!canvas) return;
  for (const node of graph.nodes) {
    const element = canvas.querySelector<HTMLElement>(`.node[data-node-id="${selectorEscape(node.id)}"]`);
    if (!element) continue;
    const status = visualNodeStatus(graph, node);
    for (const name of [...element.classList]) {
      if (name.startsWith("execution-") || name.startsWith("status-")) element.classList.remove(name);
    }
    element.classList.add(`status-${node.status}`, `execution-${status}`);
    const strip = element.querySelector<HTMLElement>(".node-status-strip");
    if (strip) strip.className = `node-status-strip ${status}`;
    const chip = element.querySelector<HTMLElement>(".node-execution-chip");
    const freshChip = elementFromMarkup(nodeExecutionChipMarkup(status));
    if (chip && freshChip) chip.replaceWith(freshChip);
    element.querySelector(".node-run-meta")?.remove();
    const meta = elementFromMarkup(nodeRunMetaMarkup(graph, node, status));
    if (meta) element.append(meta);
    const title = nodeDisplayTitle(node);
    const editorLabel = node.kind === "condition" ? "조건 편집" : node.kind === "graph_call" ? "그래프 호출 편집" : "Task 편집";
    element.setAttribute("aria-label", `${node.kind === "condition" ? "조건" : node.kind === "graph_call" ? "그래프 호출" : "작업"} 노드 ${title}, 실행 상태 ${visualNodeStatusLabel[status]}. 클릭하면 ${editorLabel}을 엽니다.`);
    element.setAttribute("title", nodeRunTooltip(graph, node, status));
  }
  for (const edge of graph.edges) {
    const source = graph.nodes.find((node) => node.id === edge.from);
    const path = canvas.querySelector<SVGPathElement>(`g[data-edge-id="${selectorEscape(edge.id)}"] .edge`);
    path?.classList.toggle("completed", source?.status === "done");
    path?.classList.toggle("active-flow", source?.status === "running");
  }
  const progress = graphProgress(graph);
  const failed = graph.nodes.filter((node) => node.status === "failed").length;
  const hud = canvas.querySelector<HTMLElement>(".progress-hud");
  if (hud) hud.innerHTML = `<strong>${progress.percent}%</strong><span>${progress.complete}/${progress.total} 완료${failed ? ` · ${failed} 실패` : ""}</span><i><b style="width:${progress.percent}%"></b></i>`;
}

function patchExecutionSurfaces(): void {
  if (view.mode === "executions") {
    const manager = app.querySelector<HTMLElement>(".execution-manager");
    const fresh = elementFromMarkup(renderExecutionManager());
    if (manager && fresh) {
      const currentHeaderCopy = manager.querySelector<HTMLElement>(".execution-manager-header > div");
      const freshHeaderCopy = fresh.querySelector<HTMLElement>(".execution-manager-header > div");
      if (currentHeaderCopy && freshHeaderCopy) morphElement(currentHeaderCopy, freshHeaderCopy);
      const currentBody = manager.querySelector<HTMLElement>(".execution-manager-body");
      const freshBody = fresh.querySelector<HTMLElement>(".execution-manager-body");
      if (currentBody && freshBody) morphElement(currentBody, freshBody);
    }
  } else if (view.mode === "canvas") {
    patchCanvasExecution(activeGraph());
  }
}

function taskHasTargetProject(taskId: string): boolean {
  return Boolean(store.tasks.find((task) => task.id === taskId)?.projects
    ?.some((project) => project.role === "target" && project.locatorKind === "folder"));
}

/** Task에 대상 프로젝트를 붙인다. 다른 편집과 같은 저장 경로를 탄다. */
function addTaskProject(taskId: string, locator: string): void {
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task || !locator) return;
  const projects = task.projects ?? [];
  if (projects.some((project) => project.locator === locator)) return;
  const project = targets.projects.find((item) => item.path === locator);
  task.projects = [...projects, {
    role: "target",
    locatorKind: "folder",
    locator,
    ...(project?.name ? { label: project.name } : {}),
    ...(project?.branch ? { branch: shortBranch(project.branch) } : {}),
    position: projects.length,
  }];
  task.updatedAt = new Date().toISOString();
  view.dirty = true;
  render();
}

function removeTaskProject(taskId: string, locator: string): void {
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task?.projects) return;
  task.projects = task.projects
    .filter((project) => project.locator !== locator)
    .map((project, position) => ({ ...project, position }));
  task.updatedAt = new Date().toISOString();
  view.dirty = true;
  render();
}

function todoTaskCreationIdempotencyKey(todo: LocalTodo): string {
  const signature = `${todo.id}:${todo.version ?? 0}:${todo.title}:${todo.notes}:${todo.draft}`;
  const current = todoTaskCreationKeys.get(todo.id);
  if (current?.signature === signature) return current.key;
  const replay = { signature, key: `todo-task-${crypto.randomUUID()}` };
  todoTaskCreationKeys.set(todo.id, replay);
  return replay.key;
}

function openTaskDetail(taskId: string): void {
  if (!store.tasks.some((task) => task.id === taskId)) throw new Error(`Task를 최신 ${workspaceProductName} snapshot에서 찾지 못했습니다: ${taskId}`);
  view.mode = "tasks";
  view.selectedTaskId = taskId;
  view.taskDetailOpen = true;
  clearGraphSelection();
  view.inspectorOpen = false;
  render();
}

async function createTaskForTodo(todoId: string): Promise<void> {
  const todo = store.todos.find((item) => item.id === todoId);
  if (!todo) return;
  if (todo.archivedAt || ["done", "cancelled"].includes(todo.status)) {
    toast(todo.archivedAt ? "보관된 ToDo는 읽기 전용입니다." : "완료되거나 취소된 ToDo에서는 Task를 생성할 수 없습니다.");
    return;
  }
  if (todo.taskId) {
    openTaskDetail(todo.taskId);
    return;
  }
  busyTodoActions.add(todo.id);
  render();
  try {
    const { task, created } = createLocalTaskFromTodo(todo);
    openTaskDetail(task.id);
    if (created) void saveStore(false).catch((error) => toast(error instanceof Error ? error.message : String(error)));
    toast(created ? "Task를 생성하고 ToDo에 연결했습니다." : "연결된 Task를 열었습니다.");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  } finally {
    busyTodoActions.delete(todo.id);
    render();
  }
}

async function chooseTodoWorktreeGraph(todoId: string): Promise<void> {
  const todo = store.todos.find((item) => item.id === todoId);
  if (!todo) return;
  if (!todo.taskId) {
    toast("먼저 Task를 생성하십시오.");
    return;
  }
  busyTodoActions.add(todo.id);
  render();
  try {
    let taskId = todo.taskId;
    let taskTitle = store.tasks.find((task) => task.id === taskId)?.title ?? taskId;
    let graphs: TodoGraphChoice[] = [...new Map(taskGraphLinks(taskId).map(({ graph }) => [graph.id, {
      id: graph.id, name: graph.name, status: graph.status,
    }])).values()];
    if (!graphs.length) {
      toast("연결된 Task가 포함된 워크트리 Graph가 없습니다. Task를 Graph에 먼저 추가하십시오.");
      return;
    }
    openModal({ kind: "todo-graph-picker", todoId: todo.id, taskId, taskTitle, graphs });
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  } finally {
    busyTodoActions.delete(todo.id);
    render();
  }
}

/* ── 실행 (세션으로 내보내기) ────────────────────────────────────────────────
 *
 * 패널이 하는 일은 프롬프트를 만들어 대상 세션에 넣는 것까지다. 그래프를 어떤
 * 순서로 도는지는 세션의 에이전트가 진행한다 — 플러그인 안에 별도 실행기를 두지
 * 않는다.
 *
 * Orca의 `terminal.sendText`는 활성 워크트리 밖의 터미널을 거부하므로, 다른
 * 프로젝트로 보내는 것은 공개 `orca` CLI를 통해 수행한다.
 */

type DispatchRequestTarget = {
  label: string;
  environmentId?: string;
  projectId?: string;
  projectName?: string;
  locator?: string;
  branch?: string;
  worktreeId?: string;
  sessionId?: string;
  sessionTitle?: string;
  model?: string;
  reasoning?: string;
  modelDefinition?: { id: string; agent: string };
  autoApprove?: boolean;
  /** 이 대상에만 보낼 프롬프트. 프로젝트별 실행은 실행 컨텍스트가 대상마다 다르다. */
  prompt?: string;
  title?: string;
};

function taskProjectLines(task: LocalTask | undefined): string[] {
  const projects = [...(task?.projects ?? [])].sort((left, right) => left.position - right.position);
  if (!projects.length) return [];
  return ["", "대상 프로젝트:", ...projects.map((project) =>
    `- ${project.role} · ${project.locatorKind}: ${project.locator}${project.branch ? ` · branch ${project.branch}` : ""}`)];
}

/**
 * 이 실행이 실제로 어디서 도는지 적는다.
 *
 * 기존 세션에 넣을 때는 모델을 우리가 정하지 않는다 — 그 세션이 이미 돌고 있는
 * 에이전트로 수행된다. 그런데도 모델 이름을 적으면 세션은 자기가 아닌 모델 이름을
 * 사실로 읽고, 자기소개 같은 작업은 그대로 틀린 답을 낸다.
 */
function routingContractLines(routing: RoutingTarget): string[] {
  return [
    "",
    "실행 컨텍스트:",
    `- environment: ${routing.environmentId || "local"}`,
    `- project: ${routing.projectId ? projectName(routing.projectId) : "current"}`,
    `- branch: ${routing.branch || "선택한 워크트리"}`,
    routing.sessionId
      ? "- model: 이 세션에서 이미 돌고 있는 에이전트 (플러그인이 지정하지 않음)"
      : `- model: ${routing.model || "agent default"}`,
  ];
}

function workItemPrompt(itemKind: "task" | "todo", item: LocalTask | LocalTodo, routing: RoutingTarget): string {
  const body = (item.metaDraft?.trim() || item.draft.trim()
    || (itemKind === "task" ? (item as LocalTask).prompt : "") || item.title);
  return [
    `${itemKind === "task" ? "Task" : "Todo"}: ${item.title} (${item.id})`,
    "",
    body,
    ...taskProjectLines(itemKind === "task" ? item as LocalTask : undefined),
    ...routingContractLines(routing),
    "",
    "이 작업만 수행한 뒤 마지막 응답의 첫 줄을 정확히 `RESULT: done` 또는 `RESULT: failed — <사유>`로 시작하십시오.",
  ].join("\n");
}

/**
 * 그래프 실행 프롬프트.
 *
 * 노드 목록만 보내면 세션은 각 노드가 무엇을 시키는지 알 수 없어, 그래프 정의를
 * 바깥 저장소에서 찾다가 실패한다(실제로 "Work Tasks에 그 그래프가 없다"며 멈췄다).
 * 정의는 여기 통째로 싣고, 밖에서 찾지 말라고 분명히 적는다.
 */
function graphPrompt(graph: GraphDefinition, routing: RoutingTarget, workInput: string): string {
  const outgoing = (nodeId: string) => graph.edges
    .filter((edge) => edge.from === nodeId)
    .map((edge) => `${edge.branch ? `분기 ${edge.branch} → ` : "→ "}${edge.to}${edge.kind === "loop" ? " (loop)" : ""}`);
  const ordered = graph.nodes.flatMap((node) => {
    const nodeRouting = effectiveRouting(graph, node);
    const kind = node.kind === "condition" ? "조건" : node.kind === "graph_call" ? "그래프 호출" : "작업";
    const body = node.kind === "condition"
      ? `판정 기준: ${node.conditionExpr || "(비어 있음 — 앞 노드 결과로 판정)"}`
      : node.kind === "graph_call"
        ? `호출 대상: ${store.graphs.find((item) => item.id === node.childGraphId)?.name ?? "(지정되지 않음)"} — 정의가 여기 없으면 이 노드는 skipped로 보고하십시오.`
        : node.task?.prompt?.trim() || "(지시문이 비어 있음 — skipped로 보고하십시오)";
    const next = outgoing(node.id);
    return [
      "",
      `── [${kind}] ${nodeDisplayTitle(node)} (${node.id})${nodeRouting.model ? ` · ${modelName(nodeRouting.model)}` : ""}`,
      ...body.split("\n").map((line) => `   ${line}`),
      ...(next.length ? [`   다음: ${next.join(" / ")}`] : ["   다음: 없음 (여기서 종료)"]),
    ];
  });
  const edges = graph.edges.map((edge) =>
    `- ${edge.from} → ${edge.to}${edge.branch ? ` · branch ${edge.branch}` : ""}${edge.kind === "loop" ? " · loop" : ""}`);
  return [
    `Graph: ${graph.name} (${graph.id})`,
    graph.summary ? `개요: ${graph.summary}` : "",
    "",
    "아래 정의가 이 그래프의 전부입니다. 이 id로 다른 저장소나 도구를 조회하지 마십시오 — 어디에도 없습니다.",
    "",
    "이 그래프를 실행하십시오. 노드를 엣지 순서대로 하나씩 처리하고, 각 노드의 결과를 기록한 뒤 다음 ready 노드로 진행합니다.",
    "조건 노드는 앞 노드의 결과로 판정하고, 판정한 분기와 일치하는 엣지의 노드로만 이어 갑니다.",
    ...(workInput.trim() ? ["", "이번 실행의 업무 입력:", workInput.trim()] : []),
    "",
    `노드 ${graph.nodes.length}개 — 각 노드의 지시문은 그 아래에 그대로 실려 있습니다:`,
    ...ordered,
    "",
    "",
    `엣지 ${graph.edges.length}개:`,
    ...edges,
    ...routingContractLines(routing),
    "",
    "노드를 시작할 때와 마칠 때 각각 다음 형식의 줄을 하나씩 출력하십시오. 패널이 이 줄을 읽어 캔버스에 진행을 표시합니다.",
    "  NODE <노드 id> running",
    "  NODE <노드 id> <done|failed|skipped> <한 줄 요약>",
    "",
    "마지막 응답의 첫 줄은 정확히 `RESULT: done` 또는 `RESULT: failed — <사유>`로 시작하십시오.",
  ].filter(Boolean).join("\n");
}

/** 라우팅 하나를 실제로 보낼 수 있는 대상으로 푼다. */
function resolveDispatchTarget(routing: RoutingTarget, label: string, locator?: string, autoApprove = true): DispatchRequestTarget {
  const environmentId = routeEnvironmentId(routing.environmentId);
  const session = routing.sessionId
    ? targets.sessions.find((item) => item.id === routing.sessionId)
    : undefined;
  if (session) {
    return {
      label,
      environmentId,
      ...(session.projectId ? { projectId: session.projectId, projectName: projectName(session.projectId) } : {}),
      ...(locator ? { locator } : {}),
      ...(session.branch ? { branch: shortBranch(session.branch) } : {}),
      sessionId: session.id,
      sessionTitle: session.title,
      ...(routing.model ? { model: routing.model } : {}),
    };
  }
  const project = routing.projectId ? targets.projects.find((item) => item.id === routing.projectId) : undefined;
  const branch = routing.branch ? shortBranch(routing.branch) : project?.branch ? shortBranch(project.branch) : "";
  const worktree = branch
    ? targets.branches?.find((item) => item.projectId === project?.id && shortBranch(item.branch) === branch)
    : undefined;
  const worktreeId = worktree?.worktreeId ?? project?.worktreeId;
  const model = routing.model ? targets.models.find((item) => item.id === routing.model) : undefined;
  return {
    label,
    environmentId,
    ...(project ? { projectId: project.id, projectName: project.name } : {}),
    ...(locator ? { locator } : {}),
    ...(branch ? { branch } : {}),
    ...(worktreeId ? { worktreeId } : {}),
    ...(routing.model ? { model: routing.model } : {}),
    ...(routing.reasoning ? { reasoning: routing.reasoning } : {}),
    ...(model ? { modelDefinition: { id: model.id, agent: model.agent } } : {}),
    // 새로 띄우는 세션에만 뜻이 있다. 기존 세션은 이미 자기 정책으로 돌고 있다.
    autoApprove,
    title: `GE · ${label}`.slice(0, 60),
  };
}

function assertDispatchable(requestTargets: DispatchRequestTarget[]): void {
  if (!requestTargets.length) throw new Error("보낼 대상을 하나 이상 선택하십시오.");
  const unroutable = requestTargets.filter((target) => !target.sessionId && !target.worktreeId);
  if (unroutable.length) {
    throw new Error(`${unroutable.map((target) => target.label).join(", ")}에 사용할 Orca 워크트리를 찾지 못했습니다. 도구 모음의 'Orca 대상 갱신'을 실행한 뒤 다시 시도하십시오.`);
  }
  const missingModel = requestTargets.filter((target) => !target.sessionId && !target.modelDefinition);
  if (missingModel.length) {
    throw new Error(`${missingModel.map((target) => target.label).join(", ")}에 새 세션을 만들 모델을 선택하십시오.`);
  }
}

/**
 * 대상 세션으로 작업을 내보낸다.
 *
 * 응답 채널이 없으므로 전달 기록은 명령을 보낸 시점에 낙관적으로 남긴다. 실제
 * 세션 생성 결과는 CLI가 같은 기록을 덮어써 다음에 패널을 열 때 정확해진다.
 */
async function dispatchWork(
  itemKind: ExecutionItemKind,
  itemId: string,
  title: string,
  prompt: string,
  requestTargets: DispatchRequestTarget[],
  executionMode: ExecutionMode,
): Promise<void> {
  assertDispatchable(requestTargets);
  // 편집과 실행은 한 줄로 함께 보낸다. 저장을 먼저 보내고 실행을 따로 보내면, 저장이
  // 도는 동안 타이핑된 실행 줄이 tty 버퍼(1024B)에서 잘려 실행이 통째로 사라진다.
  const pending = pendingSaveCommand();
  await runStoreCommands([
    ...(pending ? [pending.command] : []),
    { command: "dispatch", payload: { itemKind, itemId, title, prompt, executionMode, targets: requestTargets, panelView: currentPanelView() } },
  ]);
  if (pending) afterSaveSent();
  const record: DispatchRecord = {
    id: `dispatch-${itemKind}-${itemId}-${Date.now().toString(36)}`,
    itemKind,
    itemId,
    title,
    dispatchedAt: new Date().toISOString(),
    executionMode,
    prompt,
    targets: requestTargets.map((target) => ({
      label: target.label,
      ...(target.environmentId ? { environmentId: target.environmentId } : {}),
      ...(target.projectId ? { projectId: target.projectId } : {}),
      ...(target.projectName ? { projectName: target.projectName } : {}),
      ...(target.locator ? { locator: target.locator } : {}),
      ...(target.branch ? { branch: target.branch } : {}),
      ...(target.sessionId ? { sessionId: target.sessionId } : {}),
      ...(target.sessionTitle ? { sessionTitle: target.sessionTitle } : {}),
      ...(target.model ? { model: target.model } : {}),
      opened: target.sessionId ? "existing-session" : "new-session",
    })),
  };
  store.dispatchLog = [record, ...store.dispatchLog].slice(0, DISPATCH_LOG_LIMIT);
}

/* ── 변경분 추적 ──────────────────────────────────────────────────────────────
 *
 * 저장은 store 전체가 아니라 바뀐 항목만 보낸다. 전체를 보내면 실제 데이터에서
 * 130KB, 압축해도 터미널 한 줄에 담기지 않는다. 항목 단위로 보내면 대부분의
 * 저장이 한 줄이면 끝나고, 구조화 원천의 항목별 CAS 계약과도 그대로 맞는다.
 */

type ChangeSet = {
  graphs?: GraphDefinition[];
  domains?: LocalDomain[];
  milestones?: LocalMilestone[];
  tasks?: LocalTask[];
  todos?: LocalTodo[];
  /** 지운 항목. 없어진 것은 변경분에 실리지 않으므로 따로 알려야 한다. */
  deletions?: { tasks?: string[]; graphs?: string[]; dispatchIds?: string[] };
  /** 이 저장 시점의 패널 화면. 다시 열 때 그 화면으로 돌아간다. */
  panelView?: PanelView;
  activeGraphId?: string;
};

/** 저장으로 보내기 전까지 들고 있는 삭제 목록. */
const deletedTaskIds = new Set<string>();
const deletedDispatchIds = new Set<string>();

/** 패널을 다시 열었을 때 돌아갈 화면. 패널에는 저장소가 없어 저장 payload에 싣는다. */
function currentPanelView(): PanelView {
  return {
    mode: view.mode,
    ...(view.selectedTaskId ? { selectedTaskId: view.selectedTaskId } : {}),
    ...(view.taskDetailOpen ? { taskDetailOpen: true } : {}),
    ...(view.selectedTodoId ? { selectedTodoId: view.selectedTodoId } : {}),
  };
}

function collectChanges(): ChangeSet {
  const changes: ChangeSet = { panelView: currentPanelView() };
  for (const collection of CHANGE_COLLECTIONS) {
    const changed = store[collection].filter((item) =>
      savedBaseline.get(baselineKey(collection, item.id)) !== JSON.stringify(item));
    if (changed.length) (changes[collection] as typeof changed) = structuredClone(changed);
  }
  if (deletedTaskIds.size || deletedDispatchIds.size) {
    changes.deletions = {
      ...(deletedTaskIds.size ? { tasks: [...deletedTaskIds] } : {}),
      ...(deletedDispatchIds.size ? { dispatchIds: [...deletedDispatchIds] } : {}),
    };
  }
  if (store.activeGraphId) changes.activeGraphId = store.activeGraphId;
  return changes;
}

function changedItemCount(changes: ChangeSet): number {
  return CHANGE_COLLECTIONS.reduce((total, collection) => total + (changes[collection]?.length ?? 0), 0)
    + (changes.deletions?.tasks?.length ?? 0)
    + (changes.deletions?.dispatchIds?.length ?? 0);
}

/**
 * 지금까지의 편집을 보낼 명령. 실행처럼 뒤에 다른 명령이 이어지는 경우에는 이것을
 * 같은 줄에 묶어야 한다 — 줄을 나눠 보내면 앞 명령이 도는 동안 타이핑한 뒤 줄이
 * tty 버퍼에서 잘린다.
 */
function pendingSaveCommand(): { command: StoreCommand; count: number } | null {
  const changes = collectChanges();
  const count = changedItemCount(changes);
  return count ? { command: { command: "save", payload: changes }, count } : null;
}

/** 편집을 보낸 뒤의 뒷정리. 응답 채널이 없으므로 보낸 것을 새 기준으로 삼는다. */
function afterSaveSent(): void {
  resetBaseline();
  deletedTaskIds.clear();
  deletedDispatchIds.clear();
  view.dirty = false;
}

async function saveStore(showNotice = true, _unused = true): Promise<void> {
  const pending = pendingSaveCommand();
  if (!pending) {
    view.dirty = false;
    if (showNotice) toast("저장할 변경이 없습니다.");
    return;
  }
  const count = pending.count;
  await runStoreCommands([pending.command]);
  // 저장이 실패하면 터미널에 사유가 남고, 다음에 패널을 열 때 원천 값으로 돌아온다.
  afterSaveSent();
  if (showNotice) {
    const destination = dataSource.config.mode === "structured" ? "구조화 원천"
      : dataSource.config.mode === "folder" ? "폴더 원천" : "로컬 저장소";
    await hostCall("notifications.show", {
      title: "Graph Engineering",
      body: `${count}개 항목을 ${destination}에 저장했습니다.`,
    }).catch(() => undefined);
    toast(`${destination}에 ${count}개 항목 저장을 요청했습니다.`);
  }
}

type SourceWorkKind = "domain" | "milestone" | "task" | "todo";

function refreshManager(
  kind: SourceWorkKind,
  options: { selectedId?: string | null; taskDetailOpen?: boolean } = {},
): void {
  view.mode = ({ domain: "domains", milestone: "milestones", task: "tasks", todo: "todos" } as const)[kind];
  clearGraphSelection();
  view.inspectorOpen = false;
  if (options.selectedId !== undefined) {
    if (kind === "domain") view.selectedDomainId = options.selectedId;
    else if (kind === "milestone") view.selectedMilestoneId = options.selectedId;
    else if (kind === "task") view.selectedTaskId = options.selectedId;
    else view.selectedTodoId = options.selectedId;
  }
  if (kind === "task" && options.taskDetailOpen !== undefined) view.taskDetailOpen = options.taskDetailOpen;
  render();
}

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

/**
 * 항목 하나가 바뀌었음을 표시한다.
 *
 * 예전에는 원천에 즉시 CAS mutation을 보냈지만, 이제는 저장 버튼 한 번에 바뀐
 * 항목만 모아 보낸다. 구조화 원천의 항목별 CAS는 저장 CLI가 그대로 수행한다.
 */
function persistStructuredItem(
  _kind: SourceWorkKind,
  _item: LocalDomain | LocalMilestone | LocalTask | LocalTodo,
  _expectedVersion: number,
  _notice = "",
): void {
  view.dirty = true;
  render();
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
  void runStoreCommand("refresh")
    .then(() => {
      view.sourceRefreshing = false;
      render();
      toast("데이터를 다시 읽는 명령을 보냈습니다. 패널을 다시 열면 반영됩니다.");
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
      if (!mode || !["canvas", "list", "executions", "domains", "milestones", "tasks", "todos"].includes(mode)) return;
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
    case "refresh-data":
      void runStoreCommand("refresh")
        .then(() => toast("데이터를 다시 읽는 명령을 보냈습니다. 패널을 다시 열면 반영됩니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    case "open-execution-item": {
      const kind = target.dataset.kind;
      const id = target.dataset.id;
      if (!id) return;
      if (kind === "graph" && store.graphs.some((item) => item.id === id)) {
        store.activeGraphId = id;
        view.mode = "canvas";
        clearGraphSelection();
        render();
        window.setTimeout(fitGraph, 0);
      } else if (kind === "task" && store.tasks.some((item) => item.id === id)) {
        view.mode = "tasks";
        view.selectedTaskId = id;
        view.taskDetailOpen = true;
        render();
      } else if (kind === "todo" && store.todos.some((item) => item.id === id)) {
        view.mode = "todos";
        view.selectedTodoId = id;
        render();
      }
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
      view.dirty = true;
      refreshManager("domain", { selectedId: domain.id });
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
      view.dirty = true;
      refreshManager("milestone", { selectedId: milestone.id });
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
      refreshManager("domain", { selectedId: domain.id });
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
      refreshManager("milestone", { selectedId: milestone.id });
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
      view.dirty = true;
      refreshManager("task", { selectedId: task.id, taskDetailOpen: true });
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
      view.dirty = true;
      refreshManager("todo", { selectedId: todo.id });
      persistStructuredItem("todo", todo, 0, "Todo를 원천에 만들었습니다.");
      break;
    }
    case "select-local-task":
      view.selectedTaskId = target.dataset.id ?? null;
      view.taskDetailOpen = Boolean(view.selectedTaskId);
      render();
      break;
    case "add-task-project": {
      const taskId = target.dataset.id;
      const locator = (target as HTMLSelectElement).value;
      if (taskId && locator) addTaskProject(taskId, locator);
      break;
    }
    case "remove-task-project": {
      const taskId = target.dataset.id;
      const locator = target.dataset.locator;
      if (taskId && locator) removeTaskProject(taskId, locator);
      break;
    }
    case "open-quick-graph": {
      const task = store.tasks.find((item) => item.id === target.dataset.id && item.status !== "archived");
      if (!task) return;
      openModal({
        kind: "quick-graph", sourceTaskId: task.id, name: `${task.title} · 빠른 흐름`,
        query: "", selectedIds: [task.id], busy: false,
      });
      break;
    }
    case "toggle-quick-graph-task": {
      if (view.modal?.kind !== "quick-graph" || view.modal.busy) return;
      const modal = view.modal;
      const taskId = target.dataset.id;
      const source = store.tasks.find((item) => item.id === modal.sourceTaskId);
      if (!taskId || !source || taskId === source.id || !quickGraphCandidates(source).some((item) => item.id === taskId)) return;
      const selected = modal.selectedIds;
      modal.selectedIds = selected.includes(taskId) ? selected.filter((id) => id !== taskId) : [...selected, taskId];
      delete modal.error;
      render();
      break;
    }
    case "move-quick-graph-task": {
      if (view.modal?.kind !== "quick-graph" || view.modal.busy) return;
      const taskId = target.dataset.id;
      const delta = Number(target.dataset.delta);
      if (!taskId || ![-1, 1].includes(delta)) return;
      const index = view.modal.selectedIds.indexOf(taskId);
      const destination = index + delta;
      if (index <= 0 || destination <= 0 || destination >= view.modal.selectedIds.length) return;
      const selected = [...view.modal.selectedIds];
      [selected[index], selected[destination]] = [selected[destination]!, selected[index]!];
      view.modal.selectedIds = selected;
      render();
      break;
    }
    case "confirm-quick-graph": {
      if (view.modal?.kind !== "quick-graph" || view.modal.busy) return;
      const modal = view.modal;
      const source = store.tasks.find((item) => item.id === modal.sourceTaskId);
      if (!source) return;
      if (dataSource.config.mode !== "structured") {
        try {
          const quickGraph = createOrderedTaskGraph(source, modal.name, modal.selectedIds);
          store.graphs.push(quickGraph);
          store.activeGraphId = quickGraph.id;
          view.mode = "canvas";
          view.graphTrail = [];
          clearGraphSelection();
          view.dirty = true;
          closeModal();
          toast(`Task ${quickGraph.nodes.length}개를 순서대로 연결한 그래프를 만들었습니다.`);
          window.setTimeout(fitGraph, 0);
        } catch (error) {
          modal.error = error instanceof Error ? error.message : String(error);
          render();
        }
        break;
      }
      const expectedTaskVersion = Number(source.version ?? 0);
      if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion <= 0) {
        modal.error = "Task의 최신 CAS version을 읽지 못했습니다. Task 프로젝트를 다시 감지한 뒤 시도하십시오.";
        render();
        return;
      }
      createQuickGraphLocally(source, modal.name.trim(), [...modal.selectedIds]);
      closeModal();
      toast(`Task ${modal.selectedIds.length}개를 순서대로 연결한 그래프를 만들었습니다. 저장하면 원천에 반영됩니다.`);
      window.setTimeout(fitGraph, 0);
      break;
    }
    case "back-to-task-list":
      view.taskDetailOpen = false;
      render();
      window.setTimeout(() => app.querySelector<HTMLElement>(`[data-action="select-local-task"][data-id="${selectorEscape(view.selectedTaskId ?? "")}"]`)?.focus(), 0);
      break;
    case "select-local-todo":
      view.selectedTodoId = target.dataset.id ?? null;
      render();
      break;
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
      view.selectedTaskId = null;
      view.taskDetailOpen = false;
      view.mode = "tasks";
      closeModal();
      // 구조화 원천의 계약에는 삭제가 없다(보관이 명시적 lifecycle이다). 그 모드에서는
      // 보관하고, 로컬·폴더 저장소에서는 요청대로 지운다.
      if (dataSource.config.mode === "structured") {
        const expectedVersion = Number(task.version ?? 0);
        task.status = "archived";
        touchWorkItem(task);
        toast("이 원천은 삭제를 지원하지 않아 보관했습니다. Task 복원으로 되돌릴 수 있습니다.");
        persistStructuredItem("task", task, expectedVersion, "Task를 원천에서 보관했습니다.");
        break;
      }
      store.tasks = store.tasks.filter((item) => item.id !== taskId);
      // 이 Task를 가리키던 Todo의 연결은 끊어 둔다. 없는 id를 남기면 그 Todo는
      // 열 수 없는 Task를 계속 가리킨다.
      for (const todo of store.todos) {
        if (todo.taskId === taskId) {
          delete todo.taskId;
          touchWorkItem(todo);
        }
      }
      deletedTaskIds.add(taskId);
      view.dirty = true;
      render();
      void saveStore(false)
        .then(() => toast("Task를 삭제했습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "archive-local-task": {
      const task = store.tasks.find((item) => item.id === target.dataset.id);
      if (!task || !localWorkMutable()) return;
      const expectedVersion = Number(task.version ?? 0);
      if (task.status !== "archived") return;
      task.status = "backlog";
      touchWorkItem(task);
      refreshManager("task", { selectedId: task.id, taskDetailOpen: true });
      persistStructuredItem("task", task, expectedVersion, "Task를 원천에서 복원했습니다.");
      break;
    }
    case "promote-todo":
    case "create-task-for-todo": {
      const todoId = target.dataset.id;
      if (todoId) void createTaskForTodo(todoId);
      break;
    }
    case "open-linked-task": {
      const id = target.dataset.id;
      if (!id || !store.tasks.some((task) => task.id === id)) return;
      openTaskDetail(id);
      break;
    }
    case "open-todo-run":
    case "choose-todo-graph": {
      const todoId = target.dataset.id;
      if (todoId) void chooseTodoWorktreeGraph(todoId);
      break;
    }
    case "select-todo-graph": {
      if (view.modal?.kind !== "todo-graph-picker") return;
      const modal = view.modal;
      const graphId = target.dataset.id;
      if (!graphId || !modal.graphs.some((graph) => graph.id === graphId)) return;
      const graph = store.graphs.find((item) => item.id === graphId);
      if (!graph) {
        toast(`Graph를 최신 ${workspaceProductName} snapshot에서 찾지 못했습니다: ${graphId}`);
        return;
      }
      const taskNode = graph.nodes.find((node) => node.task?.id === modal.taskId);
      store.activeGraphId = graph.id;
      view.mode = "canvas";
      view.editorMode = "run";
      view.graphTrail = [];
      clearGraphSelection();
      if (taskNode) {
        setNodeSelection([taskNode.id], taskNode.id);
        view.inspectorOpen = true;
        view.inspectorTab = "execution";
      }
      closeModal();
      render();
      window.setTimeout(fitGraph, 0);
      break;
    }
    case "toggle-todo-done": {
      const todo = store.todos.find((item) => item.id === target.dataset.id);
      if (!todo || !localWorkMutable()) return;
      const expectedVersion = Number(todo.version ?? 0);
      todo.status = todo.status === "done" ? "open" : "done";
      touchWorkItem(todo);
      refreshManager("todo", { selectedId: todo.id });
      persistStructuredItem("todo", todo, expectedVersion);
      break;
    }
    case "cancel-local-todo": {
      const todo = store.todos.find((item) => item.id === target.dataset.id);
      if (!todo || !localWorkMutable()) return;
      const expectedVersion = Number(todo.version ?? 0);
      todo.status = todo.status === "cancelled" ? "open" : "cancelled";
      touchWorkItem(todo);
      refreshManager("todo", { selectedId: todo.id });
      persistStructuredItem("todo", todo, expectedVersion);
      break;
    }
    case "copy-graph-id":
      void navigator.clipboard.writeText(target.dataset.id ?? graph.id).then(() => toast("그래프 ID를 복사했습니다.")).catch(() => toast("ID 복사에 실패했습니다."));
      break;
    case "toggle-process": {
      const enabled = (target as HTMLInputElement).checked;
      {
        const before = graphSnapshot(graph);
        graph.processEnabled = enabled;
        touch(graph);
        recordGraphHistory(before, enabled ? "업무프로세스 지정" : "업무프로세스 해제", graph);
        render();
      }
      break;
    }
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
        void runStoreCommand("source", config)
          .then(() => {
            dataSource = { ...dataSource, config };
            closeModal();
            toast("데이터 원천 설정 명령을 보냈습니다. 패널을 다시 열면 최신 snapshot을 표시합니다.");
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
        processEnabled: false, routineEnabled: false, repeatMode: "none", defaults: {},
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
    case "reset-graph-history": {
      // 구조는 건드리지 않는다. 노드 상태만 되돌리고 run 이력 자체는 보존한다.
      // 저장하면 원천에도 같은 의미로 반영된다.
      if (!window.confirm(`${graph.name}의 실행 이력을 초기화합니다.\n노드와 연결은 그대로 두고 실행 상태만 되돌립니다. 계속할까요?`)) return;
      const before = graphSnapshot(graph);
      resetGraphRunState(graph);
      touch(graph);
      recordGraphHistory(before, "실행 이력 초기화", graph);
      clearGraphSelection();
      render();
      toast("실행 상태를 초기화했습니다. 저장하면 데이터 원천에도 반영됩니다.");
      break;
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
    case "save": void saveStore().catch((error) => toast(error instanceof Error ? error.message : String(error))); break;
    case "refresh-targets":
      void runStoreCommand("refresh")
        .then(() => toast("Orca 대상 갱신 명령을 보냈습니다. 패널을 다시 열면 반영됩니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    case "toggle-execution-history": {
      const groupKey = target.dataset.id;
      if (!groupKey) return;
      if (view.expandedExecutionItems.has(groupKey)) view.expandedExecutionItems.delete(groupKey);
      else view.expandedExecutionItems.add(groupKey);
      render();
      break;
    }
    case "delete-dispatch-record": {
      const recordId = target.dataset.id;
      if (!recordId) return;
      if (!store.dispatchLog.some((item) => item.id === recordId)) return;
      store.dispatchLog = store.dispatchLog.filter((item) => item.id !== recordId);
      deletedDispatchIds.add(recordId);
      if (view.modal?.kind === "dispatch-detail" && view.modal.recordId === recordId) closeModal();
      view.dirty = true;
      render();
      void saveStore(false)
        .then(() => toast("실행 기록 1건을 지웠습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "delete-dispatch-item": {
      const itemId = target.dataset.id;
      const itemKind = target.dataset.kind;
      if (!itemId || !itemKind) return;
      const doomed = store.dispatchLog.filter((item) => item.itemId === itemId && item.itemKind === itemKind);
      if (!doomed.length) return;
      store.dispatchLog = store.dispatchLog.filter((item) => !(item.itemId === itemId && item.itemKind === itemKind));
      for (const record of doomed) deletedDispatchIds.add(record.id);
      const openDetail = view.modal?.kind === "dispatch-detail" ? view.modal.recordId : null;
      if (openDetail && doomed.some((item) => item.id === openDetail)) closeModal();
      view.expandedExecutionItems.delete(`${itemKind}:${itemId}`);
      view.dirty = true;
      render();
      void saveStore(false)
        .then(() => toast(`실행 이력 ${doomed.length}건을 지웠습니다.`))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "open-dispatch-detail": {
      const recordId = target.dataset.id;
      if (!recordId) return;
      openModal({ kind: "dispatch-detail", recordId });
      render();
      break;
    }
    case "focus-session": {
      const terminalId = target.dataset.id;
      if (!terminalId) return;
      // 패널은 Orca UI를 조작할 수 없다. 탭을 앞으로 가져오는 것도 CLI를 거친다.
      void runStoreCommands([{ command: "focus", payload: terminalId }])
        .then(() => toast("세션 탭을 여는 명령을 보냈습니다."))
        .catch((error) => toast(error instanceof Error ? error.message : String(error)));
      break;
    }
    case "toggle-run-auto-approve":
    case "toggle-task-run-auto-approve": {
      if (view.modal?.kind !== "run" && view.modal?.kind !== "task-run") return;
      view.modal.autoApprove = !view.modal.autoApprove;
      render();
      break;
    }
    case "toggle-run-worktree": {
      if (view.modal?.kind !== "run" && view.modal?.kind !== "task-run") return;
      const modal = view.modal;
      const projectId = target.dataset.projectId;
      const environmentId = routeEnvironmentId(target.dataset.environmentId);
      const branch = target.dataset.branch ?? "";
      if (!projectId) return;
      const route = modal.kind === "run" ? modal.defaults : modal.routing;
      // 다른 머신의 워크트리를 고르면 실행 머신이 그쪽으로 옮겨 간다. 한 번의
      // 실행은 한 머신에서 돈다 — 두 머신을 섞으면 세션도 모델 목록도 갈린다.
      const switchedEnvironment = environmentId !== routeEnvironmentId(route.environmentId);
      if (switchedEnvironment) {
        route.environmentId = environmentId;
        delete route.reasoning;
        delete route.sessionId;
        modal.projectRoutings = {};
        modal.selectedProjectIds = [];
        modal.executionMode = "single_session";
      }
      const references = runModalReferences(modal);
      const candidate = runProjectCandidates(environmentId, references)
        .find((item) => item.project.id === projectId);
      if (!candidate) return;
      const routing = ensureRunProjectRouting(modal, candidate);
      const sameWorktree = !switchedEnvironment
        && modal.selectedProjectIds.includes(projectId)
        && shortBranch(routing.branch ?? "") === shortBranch(branch);
      if (sameWorktree) {
        modal.selectedProjectIds = modal.selectedProjectIds.filter((id) => id !== projectId);
      } else {
        if (branch) routing.branch = shortBranch(branch);
        else delete routing.branch;
        // 워크트리를 바꾸면 그 전 워크트리의 세션은 더 이상 이 선택과 맞지 않는다.
        delete routing.sessionId;
        if (!modal.selectedProjectIds.includes(projectId)) {
          modal.selectedProjectIds = [...modal.selectedProjectIds, projectId];
        }
      }
      if (modal.selectedProjectIds.length < 2) modal.executionMode = "single_session";
      if (!route.sessionId || switchedEnvironment) syncRunPrimaryRouting(modal, references);
      render();
      break;
    }
    case "open-task-run": {
      const task = store.tasks.find((item) => item.id === target.dataset.id);
      if (!task) return;
      openModal(createTaskRunModal(task));
      break;
    }
    case "save-task-run-settings": {
      if (view.modal?.kind !== "task-run" || view.modal.itemKind !== "task") return;
      const modal = view.modal;
      if (modal.busy || modal.saving) return;
      const task = store.tasks.find((item) => item.id === modal.itemId);
      if (!task) return;
      modal.saving = true;
      delete modal.error;
      delete modal.errorAction;
      applyTaskRunSettings(task, modal);
      render();
      void saveStore(false).then(() => {
        if (view.modal === modal) closeModal();
        render();
        toast("Task 실행 설정을 저장했습니다.");
      }).catch((error) => {
        if (view.modal === modal) {
          modal.saving = false;
          modal.error = error instanceof Error ? error.message : String(error);
          modal.errorAction = "save";
          render();
        }
      });
      break;
    }
    case "confirm-task-run": {
      if (view.modal?.kind !== "task-run") return;
      const modal = view.modal;
      if (modal.busy || modal.saving) return;
      modal.busy = true;
      delete modal.error;
      delete modal.errorAction;
      render();
      const { itemKind, itemId } = modal;
      const item = itemKind === "task"
        ? store.tasks.find((candidate) => candidate.id === itemId)
        : store.todos.find((candidate) => candidate.id === itemId);
      if (!item) { modal.busy = false; render(); return; }
      const targetProjects = itemKind === "task"
        ? ((item as LocalTask).projects ?? [])
          .filter((project) => project.role === "target" && project.locatorKind === "folder")
          .sort((left, right) => left.position - right.position)
        : [];
      const selectedProjects = selectedRunProjectCandidates(modal, targetProjects);
      const perProject = itemKind === "task" && selectedProjects.length > 1 && modal.executionMode === "per_project";
      // 통합 실행은 고른 프로젝트 중 첫 번째에서 돈다. 보내기 직전에 맞춰 두지
      // 않으면 체크한 프로젝트와 실제로 세션이 열리는 곳이 어긋날 수 있다.
      if (!perProject && selectedProjects.length && !modal.routing.sessionId) syncRunPrimaryRouting(modal, targetProjects);
      const routing = routingValue(modal.routing);
      const requestTargets = perProject
        ? selectedProjects.map((project) => {
            // 대상마다 프로젝트·브랜치·모델이 다르다. 프롬프트의 실행 컨텍스트도 그래야 한다.
            const projectRouting = routingValue(modal.projectRoutings[project.locator] ?? modal.routing);
            return {
              ...resolveDispatchTarget(projectRouting, project.label, project.locator, modal.autoApprove),
              prompt: workItemPrompt(itemKind, item, projectRouting),
            };
          })
        : [resolveDispatchTarget(routing, item.title, selectedProjects[0]?.locator, modal.autoApprove)];
      // 실행 설정은 Task에 남는다. 보내기 전에 같은 저장 경로로 먼저 기록한다.
      if (itemKind === "task") applyTaskRunSettings(item as LocalTask, modal);
      void dispatchWork(itemKind, itemId, item.title, workItemPrompt(itemKind, item, routing), requestTargets, perProject ? "per_project" : "single_session")
        .then(() => {
          if (view.modal === modal) closeModal();
          view.mode = "executions";
          render();
          toast(`${itemKind === "task" ? "Task" : "Todo"}를 ${requestTargets.length}개 세션으로 보냈습니다.`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (view.modal === modal) {
            modal.busy = false;
            modal.error = message;
            modal.errorAction = "run";
            render();
          }
          toast(message);
        });
      break;
    }
    case "open-run": openModal(createRunModal(true)); break;
    case "save-run-settings": {
      if (view.modal?.kind !== "run") return;
      const modal = view.modal;
      if (modal.busy || modal.saving) return;
      modal.saving = true;
      delete modal.error;
      delete modal.errorAction;
      applyRunDraft(graph, modal);
      render();
      void saveStore(false, false).then(() => {
        if (view.modal === modal) closeModal();
        render();
        toast("그래프 실행 설정을 저장했습니다.");
      }).catch((error) => {
        if (view.modal === modal) {
          modal.saving = false;
          modal.error = error instanceof Error ? error.message : String(error);
          modal.errorAction = "save";
          render();
        }
      });
      break;
    }
    case "confirm-run": {
      if (view.modal?.kind !== "run") return;
      const modal = view.modal;
      if (modal.busy || modal.saving) return;
      modal.busy = true;
      delete modal.error;
      delete modal.errorAction;
      render();
      const graphTargets = graphProjectTargets(graph);
      const selectedProjects = selectedRunProjectCandidates(modal, graphTargets);
      const perProject = modal.executionMode === "per_project" && selectedProjects.length > 1;
      // 통합 실행은 고른 프로젝트 중 첫 번째에서 돈다. 보내기 직전에 맞춰 두지
      // 않으면 체크한 프로젝트와 실제로 세션이 열리는 곳이 어긋날 수 있다.
      if (!perProject && selectedProjects.length && !modal.defaults.sessionId) syncRunPrimaryRouting(modal, graphTargets);
      const workInput = graph.processEnabled && modal.startNewRun ? modal.inputPrompt : "";
      const requestTargets = perProject
        ? selectedProjects.map((project) => {
            const projectRouting = routingValue(modal.projectRoutings[project.locator] ?? modal.defaults);
            return {
              ...resolveDispatchTarget(projectRouting, project.label, project.locator, modal.autoApprove),
              prompt: graphPrompt(graph, projectRouting, workInput),
            };
          })
        : [resolveDispatchTarget(routingValue(modal.defaults), graph.name, undefined, modal.autoApprove)];
      applyRunDraft(graph, modal);
      void dispatchWork(
        "graph", graph.id, graph.name,
        graphPrompt(graph, routingValue(modal.defaults), workInput),
        requestTargets, perProject ? "per_project" : "single_session",
      )
        .then(() => {
          if (view.modal === modal) closeModal();
          view.mode = "executions";
          render();
          toast(`그래프를 ${requestTargets.length}개 세션으로 보냈습니다.`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (view.modal === modal) {
            modal.busy = false;
            modal.error = message;
            modal.errorAction = "run";
            render();
          }
          toast(message);
        });
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
    case "close-modal":
      if ((view.modal?.kind === "run" || view.modal?.kind === "task-run") && (view.modal.busy || view.modal.saving)) return;
      closeModal();
      break;
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
  if ((view.modal?.kind === "run" || view.modal?.kind === "task-run") && (view.modal.busy || view.modal.saving)) return;
  if (view.editorMode === "run" && ["graph", "graph-routing", "guard", "graph-engineering", "graph-editor", "node", "task", "node-routing", "node-engineering", "node-permission", "multi-node-routing", "multi-node-engineering", "edge", "edge-endpoint"].includes(scope ?? "")) {
    toast("실행 보기의 Inspector는 읽기 전용입니다.");
    render();
    return;
  }
  const raw = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
  if (scope === "run-process" && view.modal?.kind === "run") {
    if (field === "startNewRun") view.modal.startNewRun = input.value === "new";
    else if (field === "inputPrompt") view.modal.inputPrompt = input.value;
    render();
    return;
  } else if (scope === "task-run-mode" && view.modal?.kind === "task-run") {
    view.modal.executionMode = input.value === "per_project" ? "per_project" : "single_session";
    if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
    render();
    return;
  } else if (scope === "task-run-project-routing" && view.modal?.kind === "task-run") {
    const locator = input.dataset.locator;
    if (!locator || !view.modal.projectRoutings[locator]) return;
    const routing = view.modal.projectRoutings[locator]!;
    if (field === "targetMode") {
      if (!setRoutingTargetMode(routing, String(raw))) toast("현재 Orca 환경에 사용 가능한 에이전트 세션이 없습니다.");
      else {
        if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
        render();
      }
      return;
    }
    if (raw) (routing as Record<string, unknown>)[field] = raw;
    else delete (routing as Record<string, unknown>)[field];
    if (field === "model") delete routing.reasoning;
    if (field === "sessionId" && typeof raw === "string" && raw) {
      if (!syncRouteSession(routing, raw)) {
        delete routing.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
    }
    if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
    render();
    return;
  } else if (scope === "task-run-routing" && view.modal?.kind === "task-run") {
    const modal = view.modal;
    if (field === "targetMode") {
      if (!setRoutingTargetMode(modal.routing, String(raw))) toast("현재 Orca 환경에 사용 가능한 에이전트 세션이 없습니다.");
      else render();
      return;
    }
    if (raw) (modal.routing as Record<string, unknown>)[field] = raw;
    else delete (modal.routing as Record<string, unknown>)[field];
    if (field === "environmentId") {
      delete modal.routing.reasoning;
      const references = runModalReferences(modal);
      modal.projectRoutings = {};
      const candidates = runProjectCandidates(input.value, references);
      modal.selectedProjectIds = candidates.filter((candidate) => candidate.saved).map((candidate) => candidate.project.id);
      for (const candidate of candidates.filter((item) => modal.selectedProjectIds.includes(item.project.id))) {
        ensureRunProjectRouting(modal, candidate);
      }
      if (modal.selectedProjectIds.length < 2) modal.executionMode = "single_session";
      syncRunPrimaryRouting(modal, references);
    } else if (field === "projectId" && typeof raw === "string" && raw) {
      const project = targets.projects.find((item) => item.id === raw
        && routeEnvironmentId(item.environmentId) === routeEnvironmentId(modal.routing.environmentId));
      if (project?.branch) view.modal.routing.branch = project.branch;
      else delete view.modal.routing.branch;
      clearMismatchedRouteSession(view.modal.routing);
    } else if (field === "sessionId" && typeof raw === "string" && raw) {
      if (!syncRouteSession(view.modal.routing, raw)) {
        delete view.modal.routing.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
    }
    render();
    return;
  } else if (scope === "run-mode" && view.modal?.kind === "run") {
    view.modal.executionMode = input.value === "per_project" ? "per_project" : "single_session";
    if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
    render();
    return;
  } else if (scope === "run-project-routing" && view.modal?.kind === "run") {
    const locator = input.dataset.locator;
    if (!locator || !view.modal.projectRoutings[locator]) return;
    const routing = view.modal.projectRoutings[locator]!;
    if (field === "targetMode") {
      if (!setRoutingTargetMode(routing, String(raw))) toast("현재 Orca 환경에 사용 가능한 에이전트 세션이 없습니다.");
      else {
        if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
        render();
      }
      return;
    }
    if (raw) (routing as Record<string, unknown>)[field] = raw;
    else delete (routing as Record<string, unknown>)[field];
    if (field === "model") delete routing.reasoning;
    if (field === "sessionId" && typeof raw === "string" && raw) {
      if (!syncRouteSession(routing, raw)) {
        delete routing.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
    }
    if (view.modal.executionMode === "single_session") syncRunPrimaryRouting(view.modal, runModalReferences(view.modal));
    render();
    return;
  } else if (scope === "run-routing" && view.modal?.kind === "run") {
    const modal = view.modal;
    if (field === "targetMode") {
      if (!setRoutingTargetMode(modal.defaults, String(raw))) toast("현재 Orca 환경에 사용 가능한 에이전트 세션이 없습니다.");
      else render();
      return;
    }
    if (raw) (modal.defaults as Record<string, unknown>)[field] = raw;
    else delete (modal.defaults as Record<string, unknown>)[field];
    if (field === "environmentId") {
      delete modal.defaults.reasoning;
      const references = runModalReferences(modal);
      modal.projectRoutings = {};
      const candidates = runProjectCandidates(input.value, references);
      modal.selectedProjectIds = candidates.filter((candidate) => candidate.saved).map((candidate) => candidate.project.id);
      for (const candidate of candidates.filter((item) => modal.selectedProjectIds.includes(item.project.id))) {
        ensureRunProjectRouting(modal, candidate);
      }
      if (modal.selectedProjectIds.length < 2) modal.executionMode = "single_session";
      syncRunPrimaryRouting(modal, references);
    } else if (field === "projectId" && typeof raw === "string" && raw) {
      const project = targets.projects.find((item) => item.id === raw
        && routeEnvironmentId(item.environmentId) === routeEnvironmentId(modal.defaults.environmentId));
      if (project?.branch) view.modal.defaults.branch = project.branch;
      else delete view.modal.defaults.branch;
      clearMismatchedRouteSession(view.modal.defaults);
    } else if (field === "sessionId" && typeof raw === "string" && raw) {
      if (!syncRouteSession(view.modal.defaults, raw)) {
        delete view.modal.defaults.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
    }
    render();
    return;
  } else if (scope === "task-project-branch") {
    const taskId = input.dataset.taskId;
    const locator = input.dataset.locator;
    if (!taskId || !locator) return;
    const task = store.tasks.find((item) => item.id === taskId);
    const project = task?.projects?.find((item) => item.locator === locator);
    if (!task || !project) return;
    const branch = input.value.trim();
    if (branch) project.branch = shortBranch(branch);
    else delete project.branch;
    task.updatedAt = new Date().toISOString();
    view.dirty = true;
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
    } else if (field === "metaDraft") {
      if (setMetaDraft(task, input.value)) syncTaskToGraphNodes(task);
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
    if (!todo || !localWorkMutable() || todo.archivedAt) return;
    const expectedVersion = Number(todo.version ?? 0);
    if (field === "draft") {
      setHumanDraft(todo, input.value);
      render();
      persistStructuredItem("todo", todo, expectedVersion);
      return;
    } else if (field === "metaDraft") {
      setMetaDraft(todo, input.value);
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
    if (field === "sessionId") {
      if (!syncRouteSession(graph.defaults, String(raw))) {
        delete graph.defaults.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
    } else {
      if (raw) (graph.defaults as Record<string, unknown>)[field] = raw;
      else delete (graph.defaults as Record<string, unknown>)[field];
      if (field === "projectId" || field === "environmentId") clearMismatchedRouteSession(graph.defaults);
    }
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
    if (field === "sessionId") {
      if (!raw) {
        delete node.routing.sessionId;
      } else {
      const effective = effectiveRouting(graph, node);
      const candidateRoute: RoutingTarget = {
        ...(effective.environmentId ? { environmentId: effective.environmentId } : {}),
        ...(effective.projectId ? { projectId: effective.projectId } : {}),
        ...node.routing,
      };
      if (syncRouteSession(candidateRoute, String(raw))) node.routing = { ...node.routing, ...candidateRoute };
      else {
        delete node.routing.sessionId;
        toast("선택한 Orca 환경의 세션만 사용할 수 있습니다.");
      }
      }
    } else {
      if (raw) (node.routing as unknown as Record<string, unknown>)[field] = raw;
      else delete (node.routing as unknown as Record<string, unknown>)[field];
      if (field === "projectId" || field === "environmentId") clearMismatchedRouteSession(node.routing);
    }
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
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-action="graph-search"], [data-action="work-search"], [data-action="scope-search"], [data-action="node-search"], [data-action="task-project-search"], [data-action="quick-graph-name"], [data-action="quick-graph-search"]');
  if (!input || (event as InputEvent).isComposing) return;
  const workSearch = input.dataset.action === "work-search";
  const scopeSearch = input.dataset.action === "scope-search";
  const nodeSearch = input.dataset.action === "node-search";
  const taskProjectSearch = input.dataset.action === "task-project-search";
  const quickGraphName = input.dataset.action === "quick-graph-name";
  const quickGraphSearch = input.dataset.action === "quick-graph-search";
  if (workSearch) view.workQuery = input.value;
  else if (scopeSearch) view.scopeQuery = input.value;
  else if (nodeSearch) view.nodeQuery = input.value;
  else if (taskProjectSearch) taskProjectPickerQuery = input.value;
  else if (quickGraphName && view.modal?.kind === "quick-graph") view.modal.name = input.value;
  else if (quickGraphSearch && view.modal?.kind === "quick-graph") view.modal.query = input.value;
  else view.graphQuery = input.value;
  const start = input.selectionStart;
  render();
  const next = app.querySelector<HTMLInputElement>(workSearch ? '[data-action="work-search"]' : scopeSearch ? '[data-action="scope-search"]' : nodeSearch ? '[data-action="node-search"]' : taskProjectSearch ? '[data-action="task-project-search"]' : quickGraphName ? '[data-action="quick-graph-name"]' : quickGraphSearch ? '[data-action="quick-graph-search"]' : '[data-action="graph-search"]');
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
  if (canvas && !target.closest("button, input, textarea, select, a, [role='button'], .node, .canvas-hud, .minimap, .problems-panel, .layout-preview-bar, .quick-create, .execution-banner")) {
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

/* ── 노드 호버 카드 ───────────────────────────────────────────────────────────
 *
 * 캔버스는 확대·이동하는 좌표계라, 카드를 노드 안에 그리면 배율에 따라 글자가
 * 커지거나 잘린다. 그래서 카드는 문서에 따로 띄우고 노드의 화면 좌표에 맞춘다.
 */

const NODE_HOVER_DELAY_MS = 220;
let nodeHoverElement: HTMLElement | null = null;
let nodeHoverTimer = 0;
let nodeHoverId = "";

function hideNodeHover(): void {
  if (nodeHoverTimer) window.clearTimeout(nodeHoverTimer);
  nodeHoverTimer = 0;
  nodeHoverId = "";
  nodeHoverElement?.remove();
  nodeHoverElement = null;
}

function showNodeHover(nodeElement: HTMLElement, nodeId: string): void {
  const graph = activeGraph();
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  nodeHoverElement?.remove();
  const card = document.createElement("div");
  card.className = "node-hover-card";
  card.setAttribute("role", "tooltip");
  card.innerHTML = nodeHoverCard(graph, node);
  document.body.append(card);
  nodeHoverElement = card;
  nodeHoverId = nodeId;

  const anchorRect = nodeElement.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const margin = 10;
  const right = anchorRect.right + margin;
  const left = right + cardRect.width > window.innerWidth
    ? Math.max(margin, anchorRect.left - margin - cardRect.width)
    : right;
  const top = Math.max(margin, Math.min(anchorRect.top, window.innerHeight - cardRect.height - margin));
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

app.addEventListener("pointerover", (event) => {
  const nodeElement = (event.target as HTMLElement | null)?.closest<HTMLElement>(".node[data-node-id]");
  const nodeId = nodeElement?.dataset.nodeId ?? "";
  if (!nodeId) {
    if (!(event.target as HTMLElement | null)?.closest(".node-hover-card")) hideNodeHover();
    return;
  }
  if (nodeId === nodeHoverId) return;
  if (nodeHoverTimer) window.clearTimeout(nodeHoverTimer);
  nodeHoverTimer = window.setTimeout(() => showNodeHover(nodeElement!, nodeId), NODE_HOVER_DELAY_MS);
});

// 끌거나 화면이 움직이면 카드는 곧바로 치운다. 남아 있으면 엉뚱한 자리를 가리킨다.
for (const name of ["pointerdown", "wheel", "keydown"] as const) {
  app.addEventListener(name, hideNodeHover, { capture: true });
}
app.addEventListener("pointerleave", hideNodeHover);

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
      if ((view.modal.kind === "run" || view.modal.kind === "task-run") && (view.modal.busy || view.modal.saving)) return;
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

// 현재 워크트리 이름은 실행 대상 추천에만 쓰는 힌트다. 실패해도 패널은 그대로 돈다.
void hostCall<WorkspaceContext>("workspace.readContext", {})
  .then((context) => {
    if (!context?.displayName || context.displayName === currentWorkspaceName) return;
    currentWorkspaceName = context.displayName;
  })
  .catch(() => undefined);
