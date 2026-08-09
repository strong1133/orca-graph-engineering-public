export type GraphStatus = "draft" | "active" | "running" | "done" | "archived";
export type NodeStatus = "pending" | "running" | "done" | "skipped" | "failed" | "waiting";
export type NodeKind = "task" | "condition" | "graph_call";
export type EdgeKind = "sequence" | "blocks" | "informs" | "loop";
export type NodeRole = "worker" | "router" | "verifier" | "merge" | "human_gate" | "tool";
export type ContextMode = "inherit" | "fresh" | "summary" | "reference_only";
export type TopologyKind = "path" | "diamond" | "router" | "star" | "cycle" | "tree" | "tool_bipartite";
export type GraphGroupMode = "none" | "domain" | "milestone" | "superstep" | "loop";
export const REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningLevel = typeof REASONING_LEVELS[number];

export interface NodeEngineering {
  role?: NodeRole;
  reads?: string[];
  writes?: string[];
  reducer?: "append" | "set_union" | "latest_timestamp" | "highest_confidence" | "manual";
  contextMode?: ContextMode;
  maxAttempts?: number;
  timeoutSeconds?: number;
  budgetTokens?: number;
  idempotencyKey?: string;
  sideEffect?: boolean;
  irreversible?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  compensation?: string;
  permissions?: Array<"read" | "write" | "network" | "exec">;
  evidenceRequired?: boolean;
  dataClass?: "public" | "internal" | "sensitive" | "restricted";
  retention?: "ephemeral" | "run" | "persistent";
  /** Optional editor hint. Execution providers may ignore it safely. */
  layoutPinned?: boolean;
}

export interface GraphEditorPolicy {
  groupBy?: GraphGroupMode;
  edgeWaypoints?: Record<string, Array<{ x: number; y: number }>>;
}

export interface GraphEngineeringPolicy {
  topology?: TopologyKind;
  objective?: string;
  competencyQuestions?: string[];
  globalBudgetTokens?: number;
  reservedVerificationTokens?: number;
  maxParallelism?: number;
  traversalHopLimit?: number;
  checkpointPolicy?: "none" | "superstep" | "node";
  requireProvenance?: boolean;
  humanGateForIrreversible?: boolean;
  maturity?: "standard" | "de_facto" | "experimental";
  /** Portable presentation metadata kept inside the existing v1 engineering extension. */
  editor?: GraphEditorPolicy;
}

export interface RoutingTarget {
  projectId?: string;
  sessionId?: string;
  model?: string;
  reasoning?: string;
}

export interface EffectiveRouting extends RoutingTarget {
  sources: Partial<Record<keyof RoutingTarget, "node" | "graph" | "unset">>;
}

export interface TaskPayload {
  id: string;
  title: string;
  prompt: string;
  version?: number;
  metadata?: Record<string, unknown>;
}

export type WorkPriority = "low" | "medium" | "high" | "urgent";
export type LocalTaskStatus = "backlog" | "ready" | "in_progress" | "blocked" | "done" | "archived";
export type LocalTodoStatus = "open" | "in_progress" | "done" | "cancelled";
export type DomainStatus = "active" | "archived";
export type MilestoneStatus = "active" | "blocked" | "completed" | "archived";
export type PromptRevisionKind = "draft" | "meta";
export type PromptRevisionStatus = "current" | "stale";
export type MetaPromptRunStatus = "running" | "failed";

const WORK_PRIORITIES: WorkPriority[] = ["low", "medium", "high", "urgent"];
const LOCAL_TASK_STATUSES: LocalTaskStatus[] = ["backlog", "ready", "in_progress", "blocked", "done", "archived"];
const LOCAL_TODO_STATUSES: LocalTodoStatus[] = ["open", "in_progress", "done", "cancelled"];
const DOMAIN_STATUSES: DomainStatus[] = ["active", "archived"];
const MILESTONE_STATUSES: MilestoneStatus[] = ["active", "blocked", "completed", "archived"];

export interface PromptRevision {
  id: string;
  kind: PromptRevisionKind;
  revision: number;
  content: string;
  status: PromptRevisionStatus;
  basedOnId?: string;
  generator: "human" | "meta-prompt-agent";
  createdAt: string;
}

export interface MetaPromptRun {
  status: MetaPromptRunStatus;
  requestedAt: string;
  draftRevisionId: string;
  completedAt?: string;
  error?: string;
}

export interface LocalDomain {
  id: string;
  name: string;
  summary: string;
  objectives: string;
  commonNotes: string;
  constraintNotes: string;
  status: DomainStatus;
  owners: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMilestone {
  id: string;
  domainId: string;
  name: string;
  summary: string;
  objectives: string;
  commonNotes: string;
  constraintNotes: string;
  dueDate?: string;
  status: MilestoneStatus;
  priority: WorkPriority;
  successCriteria: string[];
  owners: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalTask extends TaskPayload {
  domainId?: string;
  milestoneId?: string;
  draft: string;
  metaDraft?: string;
  promptRevisions: PromptRevision[];
  metaPromptRun?: MetaPromptRun;
  status: LocalTaskStatus;
  priority: WorkPriority;
  dueDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LocalTodo {
  id: string;
  version?: number;
  title: string;
  notes: string;
  domainId?: string;
  milestoneId?: string;
  draft: string;
  metaDraft?: string;
  promptRevisions: PromptRevision[];
  metaPromptRun?: MetaPromptRun;
  status: LocalTodoStatus;
  priority: WorkPriority;
  dueDate?: string;
  tags: string[];
  taskId?: string;
  createdAt: string;
  updatedAt: string;
}

export type DataSourceMode = "local" | "folder" | "structured" | "unstructured";

export interface DataSourceConfig {
  schemaVersion: 1;
  mode: DataSourceMode;
  folderPath?: string;
  url?: string;
  authEnv?: string;
  recordsPath?: string;
  idField?: string;
  titleField?: string;
  bodyField?: string;
}

export interface DataSourceCatalogItem {
  id: string;
  kind: "task" | "todo" | "record";
  title: string;
  body?: string;
  status?: string;
  version?: number;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface DataSourceState {
  config: DataSourceConfig;
  status: "idle" | "ready" | "error";
  source?: { id: string; name: string };
  refreshedAt?: string;
  message?: string;
  catalog: DataSourceCatalogItem[];
  capabilities?: {
    graphCommit?: boolean;
    domainMutation?: boolean;
    milestoneMutation?: boolean;
    taskMutation?: boolean;
    todoMutation?: boolean;
    promptMutation?: boolean;
    todoTaskBinding?: "create-only" | "mutable";
    taskCatalog?: boolean;
    todoCatalog?: boolean;
    /* 원격 실행 — 원천이 분산 claim/complete를 소유한다고 밝힐 때만 나타난다.
       없으면 실행은 원천 Workspace에서 시작한다(예전 경계 그대로). */
    execution?: {
      mode?: "remote-claim";
      nodeKinds?: NodeKind[];
      claimLeaseSeconds?: number;
    };
  };
}

export type GraphCallRoutingMode = "child" | "inherit" | "override";
export type GraphCallFailureMode = "fail_parent" | "continue";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  status: NodeStatus;
  joinMode: "all" | "any";
  task?: TaskPayload;
  conditionExpr?: string;
  branchTaken?: string;
  childGraphId?: string;
  graphCallRoutingMode?: GraphCallRoutingMode;
  graphCallFailureMode?: GraphCallFailureMode;
  routing?: RoutingTarget;
  engineering?: NodeEngineering;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  branch?: string;
}

export interface GraphRunRecord {
  id: string;
  runNo: number;
  status: "running" | "done" | "failed" | "cancelled" | "planned";
  startedAt: string;
  endedAt?: string;
  summary?: string;
  trigger?: "manual" | "plan" | "routine" | "loop" | "graph_call";
  parentRunId?: string;
  parentGraphId?: string;
  parentNodeId?: string;
  childRunIds?: string[];
  terminationReason?: "completed" | "node_failed" | "budget" | "timeout" | "stagnation" | "cancelled";
  stats?: { completed?: number; failed?: number; skipped?: number; attempts?: number; durationMs?: number };
  nodeResults?: Array<{ nodeId: string; status: NodeStatus; sessionId?: string; message?: string; attempt?: number; durationMs?: number; evidence?: string; childGraphId?: string; childRunId?: string }>;
}

export interface GraphDefinition {
  id: string;
  name: string;
  summary: string;
  status: GraphStatus;
  version: number;
  pinned: boolean;
  routineEnabled: boolean;
  routineSpec?: string;
  repeatMode: "none" | "loop";
  maxRuns?: number;
  defaults: RoutingTarget;
  runGuards: {
    claimLeaseSeconds?: number;
    maxWallSeconds?: number;
    stagnationRuns?: number;
    maxBudgetTokens?: number;
  };
  engineering?: GraphEngineeringPolicy;
  nodes: GraphNode[];
  edges: GraphEdge[];
  runs: GraphRunRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTarget {
  id: string;
  name: string;
  repoId?: string;
  worktreeId?: string;
  path?: string;
}

export interface SessionTarget {
  id: string;
  title: string;
  worktreeId: string;
  projectId?: string;
  paneKey?: string;
  agentType?: string;
  agentState?: string;
  writable: boolean;
  connected: boolean;
}

export interface ModelTarget {
  id: string;
  label: string;
  agent: "codex" | "claude" | "custom";
  reasoningLevels: ReasoningLevel[];
  command?: string;
}

export interface OrcaTargets {
  refreshedAt: string | null;
  projects: ProjectTarget[];
  sessions: SessionTarget[];
  models: ModelTarget[];
  error?: string;
}

export interface GraphStore {
  schemaVersion: 1;
  activeGraphId: string;
  bridgeTerminalId?: string;
  bridgeWorkspace?: string;
  lastBridgeMessage?: string;
  lastBridgeAt?: string;
  domains: LocalDomain[];
  milestones: LocalMilestone[];
  tasks: LocalTask[];
  todos: LocalTodo[];
  graphs: GraphDefinition[];
}

export interface Bootstrap {
  store: GraphStore;
  targets: OrcaTargets;
  dataSource: DataSourceState;
  pluginRoot: string;
  builtAt: string;
}

function normalizeRouting(value: RoutingTarget | undefined): RoutingTarget {
  return {
    ...(value?.projectId ? { projectId: value.projectId } : {}),
    ...(value?.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value?.model ? { model: value.model } : {}),
    ...(value?.reasoning ? { reasoning: value.reasoning } : {}),
  };
}

function normalizeNodeEngineering(value: NodeEngineering | undefined): NodeEngineering | undefined {
  if (!value) return undefined;
  return {
    ...(value.role ? { role: value.role } : {}),
    ...(value.reads ? { reads: [...value.reads] } : {}),
    ...(value.writes ? { writes: [...value.writes] } : {}),
    ...(value.reducer ? { reducer: value.reducer } : {}),
    ...(value.contextMode ? { contextMode: value.contextMode } : {}),
    ...(value.maxAttempts !== undefined ? { maxAttempts: value.maxAttempts } : {}),
    ...(value.timeoutSeconds !== undefined ? { timeoutSeconds: value.timeoutSeconds } : {}),
    ...(value.budgetTokens !== undefined ? { budgetTokens: value.budgetTokens } : {}),
    ...(value.idempotencyKey ? { idempotencyKey: value.idempotencyKey } : {}),
    ...(value.sideEffect !== undefined ? { sideEffect: value.sideEffect } : {}),
    ...(value.irreversible !== undefined ? { irreversible: value.irreversible } : {}),
    ...(value.approvalStatus ? { approvalStatus: value.approvalStatus } : {}),
    ...(value.compensation ? { compensation: value.compensation } : {}),
    ...(value.permissions ? { permissions: [...value.permissions] } : {}),
    ...(value.evidenceRequired !== undefined ? { evidenceRequired: value.evidenceRequired } : {}),
    ...(value.dataClass ? { dataClass: value.dataClass } : {}),
    ...(value.retention ? { retention: value.retention } : {}),
    ...(value.layoutPinned !== undefined ? { layoutPinned: value.layoutPinned } : {}),
  };
}

function normalizeEditorPolicy(value: GraphEditorPolicy | undefined): GraphEditorPolicy | undefined {
  if (!value) return undefined;
  const groupBy = (["none", "domain", "milestone", "superstep", "loop"] as GraphGroupMode[]).includes(value.groupBy as GraphGroupMode)
    ? value.groupBy
    : undefined;
  const edgeWaypoints = Object.fromEntries(Object.entries(value.edgeWaypoints ?? {}).flatMap(([edgeId, points]) => {
    if (!edgeId || !Array.isArray(points)) return [];
    const normalized = points
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .slice(0, 24)
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    return normalized.length ? [[edgeId, normalized]] : [];
  }));
  return {
    ...(groupBy ? { groupBy } : {}),
    ...(Object.keys(edgeWaypoints).length ? { edgeWaypoints } : {}),
  };
}

function normalizeGraph(graph: GraphDefinition): GraphDefinition {
  const normalizedEditor = normalizeEditorPolicy(graph.engineering?.editor);
  return {
    id: graph.id,
    name: graph.name,
    summary: graph.summary,
    status: graph.status,
    version: graph.version,
    pinned: graph.pinned,
    routineEnabled: graph.routineEnabled,
    ...(graph.routineSpec ? { routineSpec: graph.routineSpec } : {}),
    repeatMode: graph.repeatMode,
    ...(graph.maxRuns !== undefined ? { maxRuns: graph.maxRuns } : {}),
    defaults: normalizeRouting(graph.defaults),
    runGuards: {
      ...(graph.runGuards?.claimLeaseSeconds !== undefined ? { claimLeaseSeconds: graph.runGuards.claimLeaseSeconds } : {}),
      ...(graph.runGuards?.maxWallSeconds !== undefined ? { maxWallSeconds: graph.runGuards.maxWallSeconds } : {}),
      ...(graph.runGuards?.stagnationRuns !== undefined ? { stagnationRuns: graph.runGuards.stagnationRuns } : {}),
      ...(graph.runGuards?.maxBudgetTokens !== undefined ? { maxBudgetTokens: graph.runGuards.maxBudgetTokens } : {}),
    },
    ...(graph.engineering ? { engineering: {
      ...(graph.engineering.topology ? { topology: graph.engineering.topology } : {}),
      ...(graph.engineering.objective ? { objective: graph.engineering.objective } : {}),
      ...(graph.engineering.competencyQuestions ? { competencyQuestions: [...graph.engineering.competencyQuestions] } : {}),
      ...(graph.engineering.globalBudgetTokens !== undefined ? { globalBudgetTokens: graph.engineering.globalBudgetTokens } : {}),
      ...(graph.engineering.reservedVerificationTokens !== undefined ? { reservedVerificationTokens: graph.engineering.reservedVerificationTokens } : {}),
      ...(graph.engineering.maxParallelism !== undefined ? { maxParallelism: graph.engineering.maxParallelism } : {}),
      ...(graph.engineering.traversalHopLimit !== undefined ? { traversalHopLimit: graph.engineering.traversalHopLimit } : {}),
      ...(graph.engineering.checkpointPolicy ? { checkpointPolicy: graph.engineering.checkpointPolicy } : {}),
      ...(graph.engineering.requireProvenance !== undefined ? { requireProvenance: graph.engineering.requireProvenance } : {}),
      ...(graph.engineering.humanGateForIrreversible !== undefined ? { humanGateForIrreversible: graph.engineering.humanGateForIrreversible } : {}),
      ...(graph.engineering.maturity ? { maturity: graph.engineering.maturity } : {}),
      ...(normalizedEditor ? { editor: normalizedEditor } : {}),
    } } : {}),
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      x: node.x,
      y: node.y,
      status: node.status,
      joinMode: node.joinMode,
      ...(node.task ? { task: {
        id: node.task.id,
        title: node.task.title,
        prompt: node.task.prompt,
        ...(node.task.version !== undefined ? { version: node.task.version } : {}),
        ...(node.task.metadata ? { metadata: structuredClone(node.task.metadata) } : {}),
      } } : {}),
      ...(node.conditionExpr ? { conditionExpr: node.conditionExpr } : {}),
      ...(node.branchTaken ? { branchTaken: node.branchTaken } : {}),
      ...(node.childGraphId ? { childGraphId: node.childGraphId } : {}),
      ...(node.graphCallRoutingMode ? { graphCallRoutingMode: node.graphCallRoutingMode } : {}),
      ...(node.graphCallFailureMode ? { graphCallFailureMode: node.graphCallFailureMode } : {}),
      ...(node.routing ? { routing: normalizeRouting(node.routing) } : {}),
      ...(node.engineering ? { engineering: normalizeNodeEngineering(node.engineering)! } : {}),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      ...(edge.branch ? { branch: edge.branch } : {}),
    })),
    runs: graph.runs.map((run) => ({
      id: run.id,
      runNo: run.runNo,
      status: run.status,
      startedAt: run.startedAt,
      ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      ...(run.summary ? { summary: run.summary } : {}),
      ...(run.trigger ? { trigger: run.trigger } : {}),
      ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      ...(run.parentGraphId ? { parentGraphId: run.parentGraphId } : {}),
      ...(run.parentNodeId ? { parentNodeId: run.parentNodeId } : {}),
      ...(run.childRunIds ? { childRunIds: [...run.childRunIds] } : {}),
      ...(run.terminationReason ? { terminationReason: run.terminationReason } : {}),
      ...(run.stats ? { stats: { ...run.stats } } : {}),
      ...(run.nodeResults ? { nodeResults: run.nodeResults.map((result) => ({ ...result })) } : {}),
    })),
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
  };
}

function normalizePromptPair(
  id: string,
  draftValue: string,
  metaValue: string | undefined,
  revisionsValue: PromptRevision[] | undefined,
  createdAt: string,
): { draft: string; metaDraft?: string; prompt: string; promptRevisions: PromptRevision[] } {
  const draft = draftValue || id;
  const revisions = (revisionsValue ?? []).filter((item) =>
    item?.id && (item.kind === "draft" || item.kind === "meta")
    && Number.isInteger(item.revision) && item.revision > 0 && typeof item.content === "string",
  ).map((item) => ({
    id: item.id,
    kind: item.kind,
    revision: item.revision,
    content: item.content,
    status: item.status === "current" ? "current" as const : "stale" as const,
    ...(item.basedOnId ? { basedOnId: item.basedOnId } : {}),
    generator: item.kind === "meta" ? "meta-prompt-agent" as const : "human" as const,
    createdAt: item.createdAt || createdAt,
  }));
  let currentDraft = [...revisions]
    .filter((item) => item.kind === "draft" && item.content === draft)
    .sort((left, right) => right.revision - left.revision)[0];
  if (!currentDraft) {
    currentDraft = {
      id: `${id}:draft:${Math.max(0, ...revisions.map((item) => item.revision)) + 1}`,
      kind: "draft",
      revision: Math.max(0, ...revisions.map((item) => item.revision)) + 1,
      content: draft,
      status: "current",
      generator: "human",
      createdAt,
    };
    revisions.push(currentDraft);
  }
  for (const item of revisions) if (item.kind === "draft") item.status = item.id === currentDraft.id ? "current" : "stale";

  const metaDraft = metaValue || undefined;
  const matchingMeta = metaDraft
    ? [...revisions].filter((item) => item.kind === "meta" && item.content === metaDraft)
      .sort((left, right) => right.revision - left.revision)[0]
    : undefined;
  let currentMeta = metaDraft
    ? [...revisions]
      .filter((item) => item.kind === "meta" && item.content === metaDraft && item.basedOnId === currentDraft.id)
      .sort((left, right) => right.revision - left.revision)[0]
    : undefined;
  if (metaDraft && !currentMeta && !matchingMeta) {
    currentMeta = {
      id: `${id}:meta:${Math.max(0, ...revisions.map((item) => item.revision)) + 1}`,
      kind: "meta",
      revision: Math.max(0, ...revisions.map((item) => item.revision)) + 1,
      content: metaDraft,
      status: "current",
      basedOnId: currentDraft.id,
      generator: "meta-prompt-agent",
      createdAt,
    };
    revisions.push(currentMeta);
  }
  for (const item of revisions) if (item.kind === "meta") item.status = item.id === currentMeta?.id ? "current" : "stale";
  revisions.sort((left, right) => left.revision - right.revision || left.createdAt.localeCompare(right.createdAt));
  return {
    draft,
    ...(metaDraft ? { metaDraft } : {}),
    prompt: currentMeta?.content || draft,
    promptRevisions: revisions,
  };
}

export function currentDraftRevision(item: Pick<LocalTask | LocalTodo, "promptRevisions">): PromptRevision | undefined {
  return item.promptRevisions.find((revision) => revision.kind === "draft" && revision.status === "current");
}

export function currentMetaRevision(item: Pick<LocalTask | LocalTodo, "promptRevisions">): PromptRevision | undefined {
  return item.promptRevisions.find((revision) => revision.kind === "meta" && revision.status === "current");
}

export function normalizeGraphStore(
  input: Omit<GraphStore, "domains" | "milestones" | "tasks" | "todos">
    & Partial<Pick<GraphStore, "domains" | "milestones" | "tasks" | "todos">>,
): GraphStore {
  const graphs = input.graphs.map(normalizeGraph);
  const domainMap = new Map<string, LocalDomain>();
  for (const domain of input.domains ?? []) {
    if (!domain?.id || domainMap.has(domain.id)) continue;
    const createdAt = domain.createdAt || new Date(0).toISOString();
    domainMap.set(domain.id, {
      id: domain.id,
      name: domain.name || domain.id,
      summary: domain.summary ?? "",
      objectives: domain.objectives ?? "",
      commonNotes: domain.commonNotes ?? "",
      constraintNotes: domain.constraintNotes ?? "",
      status: DOMAIN_STATUSES.includes(domain.status) ? domain.status : "active",
      owners: [...(domain.owners ?? [])],
      version: Number.isInteger(domain.version) && domain.version > 0 ? domain.version : 1,
      createdAt,
      updatedAt: domain.updatedAt || createdAt,
    });
  }
  const milestoneMap = new Map<string, LocalMilestone>();
  for (const milestone of input.milestones ?? []) {
    if (!milestone?.id || milestoneMap.has(milestone.id) || !domainMap.has(milestone.domainId)) continue;
    const createdAt = milestone.createdAt || new Date(0).toISOString();
    milestoneMap.set(milestone.id, {
      id: milestone.id,
      domainId: milestone.domainId,
      name: milestone.name || milestone.id,
      summary: milestone.summary ?? "",
      objectives: milestone.objectives ?? "",
      commonNotes: milestone.commonNotes ?? "",
      constraintNotes: milestone.constraintNotes ?? "",
      ...(milestone.dueDate ? { dueDate: milestone.dueDate } : {}),
      status: MILESTONE_STATUSES.includes(milestone.status) ? milestone.status : "active",
      priority: WORK_PRIORITIES.includes(milestone.priority) ? milestone.priority : "medium",
      successCriteria: [...(milestone.successCriteria ?? [])],
      owners: [...(milestone.owners ?? [])],
      version: Number.isInteger(milestone.version) && milestone.version > 0 ? milestone.version : 1,
      createdAt,
      updatedAt: milestone.updatedAt || createdAt,
    });
  }
  const taskMap = new Map<string, LocalTask>();
  for (const task of input.tasks ?? []) {
    if (!task?.id || taskMap.has(task.id)) continue;
    const createdAt = task.createdAt || new Date(0).toISOString();
    const pair = normalizePromptPair(
      task.id,
      task.draft || task.prompt || task.title || task.id,
      task.metaDraft,
      task.promptRevisions,
      createdAt,
    );
    const milestone = task.milestoneId ? milestoneMap.get(task.milestoneId) : undefined;
    const domainId = milestone?.domainId ?? (task.domainId && domainMap.has(task.domainId) ? task.domainId : undefined);
    taskMap.set(task.id, {
      id: task.id,
      title: task.title || task.id,
      prompt: pair.prompt,
      ...(task.version !== undefined ? { version: task.version } : {}),
      ...(task.metadata ? { metadata: structuredClone(task.metadata) } : {}),
      ...(domainId ? { domainId } : {}),
      ...(milestone ? { milestoneId: milestone.id } : {}),
      draft: pair.draft,
      ...(pair.metaDraft ? { metaDraft: pair.metaDraft } : {}),
      promptRevisions: pair.promptRevisions,
      ...(task.metaPromptRun?.status === "running" || task.metaPromptRun?.status === "failed"
        ? { metaPromptRun: structuredClone(task.metaPromptRun) } : {}),
      status: LOCAL_TASK_STATUSES.includes(task.status) ? task.status : "backlog",
      priority: WORK_PRIORITIES.includes(task.priority) ? task.priority : "medium",
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      tags: [...(task.tags ?? [])],
      createdAt,
      updatedAt: task.updatedAt || createdAt,
    });
  }
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (!node.task || taskMap.has(node.task.id)) continue;
      const status: LocalTaskStatus = node.status === "done"
        ? "done"
        : node.status === "running"
          ? "in_progress"
          : node.status === "failed" || node.status === "waiting"
            ? "blocked"
            : "ready";
      taskMap.set(node.task.id, {
        id: node.task.id,
        title: node.task.title,
        prompt: node.task.prompt,
        ...(node.task.version !== undefined ? { version: node.task.version } : {}),
        ...(node.task.metadata ? { metadata: structuredClone(node.task.metadata) } : {}),
        draft: node.task.prompt,
        promptRevisions: [{
          id: `${node.task.id}:draft:1`, kind: "draft", revision: 1, content: node.task.prompt,
          status: "current", generator: "human", createdAt: graph.createdAt,
        }],
        status,
        priority: "medium",
        tags: [],
        createdAt: graph.createdAt,
        updatedAt: graph.updatedAt,
      });
    }
  }
  const todoMap = new Map<string, LocalTodo>();
  for (const todo of input.todos ?? []) {
    if (!todo?.id) continue;
    if (todoMap.has(todo.id)) continue;
    const createdAt = todo.createdAt || new Date(0).toISOString();
    const pair = normalizePromptPair(
      todo.id,
      todo.draft || todo.notes || todo.title || todo.id,
      todo.metaDraft,
      todo.promptRevisions,
      createdAt,
    );
    const milestone = todo.milestoneId ? milestoneMap.get(todo.milestoneId) : undefined;
    const domainId = milestone?.domainId ?? (todo.domainId && domainMap.has(todo.domainId) ? todo.domainId : undefined);
    todoMap.set(todo.id, {
      id: todo.id,
      ...(todo.version !== undefined ? { version: todo.version } : {}),
      title: todo.title || todo.id,
      notes: todo.notes ?? "",
      ...(domainId ? { domainId } : {}),
      ...(milestone ? { milestoneId: milestone.id } : {}),
      draft: pair.draft,
      ...(pair.metaDraft ? { metaDraft: pair.metaDraft } : {}),
      promptRevisions: pair.promptRevisions,
      ...(todo.metaPromptRun?.status === "running" || todo.metaPromptRun?.status === "failed"
        ? { metaPromptRun: structuredClone(todo.metaPromptRun) } : {}),
      status: LOCAL_TODO_STATUSES.includes(todo.status) ? todo.status : "open",
      priority: WORK_PRIORITIES.includes(todo.priority) ? todo.priority : "medium",
      ...(todo.dueDate ? { dueDate: todo.dueDate } : {}),
      tags: [...(todo.tags ?? [])],
      ...(todo.taskId ? { taskId: todo.taskId } : {}),
      createdAt,
      updatedAt: todo.updatedAt || createdAt,
    });
  }
  const activeGraphId = graphs.some((graph) => graph.id === input.activeGraphId)
    ? input.activeGraphId
    : graphs[0]?.id ?? "";
  return {
    schemaVersion: 1,
    activeGraphId,
    ...(input.bridgeTerminalId ? { bridgeTerminalId: input.bridgeTerminalId } : {}),
    ...(input.bridgeWorkspace ? { bridgeWorkspace: input.bridgeWorkspace } : {}),
    ...(input.lastBridgeMessage ? { lastBridgeMessage: input.lastBridgeMessage } : {}),
    ...(input.lastBridgeAt ? { lastBridgeAt: input.lastBridgeAt } : {}),
    domains: [...domainMap.values()],
    milestones: [...milestoneMap.values()],
    tasks: [...taskMap.values()],
    todos: [...todoMap.values()],
    graphs,
  };
}

export const NODE_WIDTH = 228;
export const NODE_HEIGHT = 104;
export const GRID = 16;

export interface EngineeringFinding {
  code?: string;
  severity: "error" | "warning" | "info";
  category: "structure" | "reliability" | "state" | "context" | "security" | "provenance" | "operations";
  message: string;
  chapter: number;
  nodeId?: string;
}

export interface GraphAnalysis {
  levels: Map<string, number>;
  supersteps: string[][];
  criticalPathNodeIds: string[];
  loopNodeIds: string[];
  sourceNodeIds: string[];
  sinkNodeIds: string[];
  depth: number;
  maxParallelism: number;
  edgeDensity: number;
  findings: EngineeringFinding[];
}

export interface GraphLinkFinding {
  severity: "error" | "warning";
  message: string;
  graphId: string;
  nodeId?: string;
}

export const TOPOLOGY_TEMPLATES: Array<{ id: TopologyKind; label: string; help: string }> = [
  { id: "path", label: "경로", help: "선형 의존성이 실제인 가장 단순한 구조" },
  { id: "diamond", label: "다이아몬드", help: "fan-out → 병렬 작업 → merge → 독립 verifier" },
  { id: "router", label: "라우터", help: "조건 노드가 명시적 branch로 작업을 선택" },
  { id: "star", label: "성형", help: "supervisor가 여러 worker를 조율" },
  { id: "cycle", label: "생성-비평 순환", help: "generator와 critic, 유한 loop guard" },
  { id: "tree", label: "트리", help: "계층적으로 분해하고 위로 합치는 구조" },
  { id: "tool_bipartite", label: "도구 이분", help: "agent와 외부 tool 경계를 분리" },
];

const ROUTING_KEYS: Array<keyof RoutingTarget> = ["projectId", "sessionId", "model", "reasoning"];

export function effectiveRouting(graph: GraphDefinition, node: GraphNode): EffectiveRouting {
  const result: EffectiveRouting = { sources: {} };
  for (const key of ROUTING_KEYS) {
    const nodeValue = node.routing?.[key];
    const graphValue = graph.defaults[key];
    if (nodeValue) {
      result[key] = nodeValue;
      result.sources[key] = "node";
    } else if (graphValue) {
      result[key] = graphValue;
      result.sources[key] = "graph";
    } else {
      result.sources[key] = "unset";
    }
  }
  return result;
}

export function modelReasoningLevels(targets: OrcaTargets, modelId: string | undefined): ReasoningLevel[] {
  const selected = modelId || "gpt-5.6-sol";
  return [...(targets.models.find((model) => model.id === selected)?.reasoningLevels ?? [])];
}

export function reasoningRouteError(
  route: RoutingTarget,
  targets: OrcaTargets,
  options: { existingSession?: boolean } = {},
): { code: "EXISTING_SESSION_REASONING_OVERRIDE_UNSUPPORTED" | "REASONING_LEVEL_UNSUPPORTED"; message: string } | null {
  if (!route.reasoning) return null;
  if (options.existingSession) {
    return {
      code: "EXISTING_SESSION_REASONING_OVERRIDE_UNSUPPORTED",
      message: "기존 세션에는 reasoning override를 적용할 수 없습니다. 값을 비우면 세션의 현재 effort를 유지합니다.",
    };
  }
  const modelId = route.model || "gpt-5.6-sol";
  if (!modelReasoningLevels(targets, modelId).includes(route.reasoning as ReasoningLevel)) {
    return {
      code: "REASONING_LEVEL_UNSUPPORTED",
      message: `${modelId}: reasoning '${route.reasoning}'은 지원되지 않습니다.`,
    };
  }
  return null;
}

export function topologicalOrder(graph: GraphDefinition): string[] {
  const liveNodes = graph.nodes.filter((node) => node.status !== "skipped");
  const ids = new Set(liveNodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => edge.kind !== "loop" && ids.has(edge.from) && ids.has(edge.to),
  );
  const indegree = new Map(liveNodes.map((node) => [node.id, 0]));
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const queue = liveNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    ordered.push(id);
    for (const edge of edges.filter((item) => item.from === id)) {
      const next = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  return ordered;
}

export function autoLayout(
  graph: GraphDefinition,
  direction: "LR" | "TB" = "LR",
  options: { nodeIds?: readonly string[]; preservePinned?: boolean } = {},
): GraphDefinition {
  const order = topologicalOrder(graph);
  const level = new Map<string, number>();
  for (const id of order) {
    const incoming = graph.edges.filter((edge) => edge.kind !== "loop" && edge.to === id);
    level.set(id, incoming.length ? Math.max(...incoming.map((edge) => (level.get(edge.from) ?? 0) + 1)) : 0);
  }
  const selected = options.nodeIds ? new Set(options.nodeIds) : null;
  const movable = new Set(graph.nodes
    .filter((node) => (!selected || selected.has(node.id)) && !(options.preservePinned !== false && node.engineering?.layoutPinned))
    .map((node) => node.id));
  const rows = new Map<number, number>();
  const current = graph.nodes.filter((node) => movable.has(node.id));
  const currentCenter = current.length ? {
    x: current.reduce((sum, node) => sum + node.x, 0) / current.length,
    y: current.reduce((sum, node) => sum + node.y, 0) / current.length,
  } : { x: 0, y: 0 };
  const targets = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    const column = level.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    if (!movable.has(node.id)) continue;
    const primary = 48 + column * 292;
    const secondary = 48 + row * 142;
    targets.set(node.id, {
      x: direction === "LR" ? primary : secondary,
      y: direction === "LR" ? secondary : primary,
    });
  }
  const targetValues = [...targets.values()];
  const targetCenter = targetValues.length ? {
    x: targetValues.reduce((sum, point) => sum + point.x, 0) / targetValues.length,
    y: targetValues.reduce((sum, point) => sum + point.y, 0) / targetValues.length,
  } : currentCenter;
  const nodes = graph.nodes.map((node) => {
    const target = targets.get(node.id);
    if (!target) return { ...node };
    const keepSelectionAnchor = Boolean(selected);
    return {
      ...node,
      x: target.x + (keepSelectionAnchor ? currentCenter.x - targetCenter.x : 0),
      y: target.y + (keepSelectionAnchor ? currentCenter.y - targetCenter.y : 0),
    };
  });
  return { ...graph, nodes, version: graph.version + 1, updatedAt: new Date().toISOString() };
}

function basicValidation(graph: GraphDefinition, { targets }: { live?: boolean; targets?: OrcaTargets } = {}): EngineeringFinding[] {
  const findings: EngineeringFinding[] = [];
  const add = (
    severity: EngineeringFinding["severity"],
    category: EngineeringFinding["category"],
    message: string,
    chapter: number,
    nodeId?: string,
    code?: string,
  ) => findings.push({ severity, category, message, chapter, ...(nodeId ? { nodeId } : {}), ...(code ? { code } : {}) });
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!graph.nodes.length) add("error", "structure", "노드가 없습니다.", 1);
  if (ids.size !== graph.nodes.length) add("error", "structure", "중복된 노드 ID가 있습니다.", 14, undefined, "DUPLICATE_NODE_ID");
  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) {
    add("error", "structure", "중복된 엣지 ID가 있습니다.", 14, undefined, "DUPLICATE_EDGE_ID");
  }
  for (const node of graph.nodes) {
    if (node.kind === "task" && (!node.task?.title.trim() || !node.task.prompt.trim())) {
      add("error", "structure", `${node.label || node.id}: Task 제목과 지시문이 필요합니다.`, 18, node.id);
    }
    if (node.kind === "condition" && !node.conditionExpr?.trim()) {
      add("error", "structure", `${node.label || node.id}: 조건 정의가 필요합니다.`, 20, node.id);
    }
    if (node.kind === "graph_call" && !node.childGraphId) {
      add("error", "structure", `${node.label || node.id}: 호출할 그래프가 필요합니다.`, 25, node.id);
    }
    const route = effectiveRouting(graph, node);
    if (node.kind === "task" && targets) {
      const reasoningError = reasoningRouteError(route, targets, {
        existingSession: Boolean(route.sessionId && node.engineering?.contextMode !== "fresh"),
      });
      if (reasoningError) {
        add("error", "context", `${node.label || node.id}: ${reasoningError.message}`, 24, node.id, reasoningError.code);
      }
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) add("error", "structure", `${edge.id}: 존재하지 않는 노드를 연결합니다.`, 14);
    if (edge.from === edge.to) add("error", "structure", `${edge.id}: 자기 자신으로 연결할 수 없습니다.`, 14);
  }
  if (topologicalOrder(graph).length !== graph.nodes.filter((node) => node.status !== "skipped").length) {
    add("error", "structure", "loop으로 표시되지 않은 순환 연결이 있습니다.", 20);
  }
  return findings;
}

export function topologicalLevels(graph: GraphDefinition): Map<string, number> {
  const order = topologicalOrder(graph);
  const levels = new Map<string, number>();
  for (const id of order) {
    const incoming = graph.edges.filter(
      (edge) => edge.kind !== "loop" && edge.to === id && levels.has(edge.from),
    );
    levels.set(
      id,
      incoming.length ? Math.max(...incoming.map((edge) => (levels.get(edge.from) ?? 0) + 1)) : 0,
    );
  }
  for (const node of graph.nodes) if (!levels.has(node.id)) levels.set(node.id, 0);
  return levels;
}

function reachable(start: string, edges: GraphEdge[], reverse = false): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    for (const edge of edges) {
      const from = reverse ? edge.to : edge.from;
      const to = reverse ? edge.from : edge.to;
      if (from === id && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

function normalizeBranch(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function executableNonLoopGraph(
  graph: GraphDefinition,
  liveIds: Set<string>,
): { edges: GraphEdge[]; nodeIds: Set<string> } {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const structuralEdges = graph.edges.filter(
    (edge) => edge.kind !== "loop" && liveIds.has(edge.from) && liveIds.has(edge.to),
  );
  const enabled = (edge: GraphEdge): boolean => {
    const source = nodes.get(edge.from);
    const selected = source?.kind === "condition" ? normalizeBranch(source.branchTaken) : "";
    return !selected || normalizeBranch(edge.branch) === selected;
  };
  const reachableIds = new Set<string>();
  for (const id of topologicalOrder(graph)) {
    const node = nodes.get(id);
    if (!node) continue;
    const incoming = structuralEdges.filter((edge) => edge.to === id);
    if (!incoming.length) {
      reachableIds.add(id);
      continue;
    }
    const open = incoming.map((edge) => enabled(edge) && reachableIds.has(edge.from));
    if (node.joinMode === "any" ? open.some(Boolean) : open.every(Boolean)) reachableIds.add(id);
  }
  return {
    edges: structuralEdges.filter((edge) => enabled(edge) && reachableIds.has(edge.from) && reachableIds.has(edge.to)),
    nodeIds: reachableIds,
  };
}

function dominators(graph: GraphDefinition, edges: GraphEdge[], nodeIds: Set<string>): Map<string, Set<string>> {
  const incoming = new Map([...nodeIds].map((id) => [id, [] as string[]]));
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);
  const result = new Map<string, Set<string>>();
  for (const id of topologicalOrder(graph).filter((candidate) => nodeIds.has(candidate))) {
    const predecessors = incoming.get(id) ?? [];
    if (!predecessors.length) {
      result.set(id, new Set([id]));
      continue;
    }
    const first = result.get(predecessors[0] ?? "") ?? new Set<string>();
    const shared = new Set(first);
    for (const predecessor of predecessors.slice(1)) {
      const predecessorDominators = result.get(predecessor) ?? new Set<string>();
      for (const candidate of shared) if (!predecessorDominators.has(candidate)) shared.delete(candidate);
    }
    shared.add(id);
    result.set(id, shared);
  }
  return result;
}

function hasApprovedDominatingGate(
  graph: GraphDefinition,
  nodeId: string,
  executable: { edges: GraphEdge[]; nodeIds: Set<string> },
): boolean {
  if (!executable.nodeIds.has(nodeId)) return true;
  const nodeDominators = dominators(graph, executable.edges, executable.nodeIds).get(nodeId) ?? new Set<string>();
  return graph.nodes.some((candidate) =>
    candidate.id !== nodeId && nodeDominators.has(candidate.id) &&
    candidate.engineering?.role === "human_gate" &&
    candidate.engineering.approvalStatus === "approved",
  );
}

export function analyzeGraph(graph: GraphDefinition, options: { live?: boolean; targets?: OrcaTargets } = {}): GraphAnalysis {
  const findings = basicValidation(graph, options);
  const levels = topologicalLevels(graph);
  const liveIds = new Set(graph.nodes.filter((node) => node.status !== "skipped").map((node) => node.id));
  const dagEdges = graph.edges.filter(
    (edge) => edge.kind !== "loop" && liveIds.has(edge.from) && liveIds.has(edge.to),
  );
  const executable = executableNonLoopGraph(graph, liveIds);
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as GraphEdge[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as GraphEdge[]]));
  for (const edge of dagEdges) {
    incoming.get(edge.to)?.push(edge);
    outgoing.get(edge.from)?.push(edge);
  }
  const sourceNodeIds = graph.nodes.filter((node) => !(incoming.get(node.id)?.length)).map((node) => node.id);
  const sinkNodeIds = graph.nodes.filter((node) => !(outgoing.get(node.id)?.length)).map((node) => node.id);
  const order = topologicalOrder(graph);
  const distance = new Map<string, number>();
  const predecessor = new Map<string, string>();
  for (const id of order) {
    const candidates = (incoming.get(id) ?? []).map((edge) => ({
      id: edge.from,
      distance: (distance.get(edge.from) ?? 0) + 1,
    }));
    const best = candidates.sort((a, b) => b.distance - a.distance)[0];
    distance.set(id, best?.distance ?? 0);
    if (best) predecessor.set(id, best.id);
  }
  let cursor = [...distance.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const criticalPathNodeIds: string[] = [];
  while (cursor) {
    criticalPathNodeIds.unshift(cursor);
    cursor = predecessor.get(cursor);
  }
  const supersteps = [...new Set(levels.values())]
    .sort((a, b) => a - b)
    .map((level) => graph.nodes.filter((node) => levels.get(node.id) === level).map((node) => node.id));
  const maxParallelism = Math.max(0, ...supersteps.map((step) => step.length));
  const depth = Math.max(0, ...levels.values()) + (graph.nodes.length ? 1 : 0);
  const edgeDensity = graph.nodes.length > 1
    ? dagEdges.length / (graph.nodes.length * (graph.nodes.length - 1))
    : 0;

  const loopNodeIds = new Set<string>();
  for (const edge of graph.edges.filter((item) => item.kind === "loop")) {
    const fromHead = reachable(edge.to, dagEdges);
    const toTail = reachable(edge.from, dagEdges, true);
    for (const id of fromHead) if (toTail.has(id)) loopNodeIds.add(id);
    loopNodeIds.add(edge.from);
    loopNodeIds.add(edge.to);
  }

  const add = (
    severity: EngineeringFinding["severity"],
    category: EngineeringFinding["category"],
    message: string,
    chapter: number,
    nodeId?: string,
    code?: string,
  ) => findings.push({ severity, category, message, chapter, ...(nodeId ? { nodeId } : {}), ...(code ? { code } : {}) });

  for (const node of graph.nodes) {
    const degree = (incoming.get(node.id)?.length ?? 0) + (outgoing.get(node.id)?.length ?? 0);
    if (graph.nodes.length > 1 && degree === 0) add("warning", "structure", `${node.label}: 연결되지 않은 고아 노드입니다.`, 14, node.id);
    if ((outgoing.get(node.id)?.length ?? 0) > 8) add("info", "operations", `${node.label}: fan-out이 8을 초과합니다. 실행 폭과 비용을 확인하세요.`, 33, node.id);
    if (node.kind === "condition") {
      const conditionEdges = graph.edges.filter((edge) => edge.from === node.id);
      const labels = conditionEdges.map((edge) => normalizeBranch(edge.branch));
      if (!conditionEdges.length || labels.some((label) => !label)) {
        add("error", "structure", `${node.label}: 모든 출력 엣지에 조건 분기 라벨이 필요합니다.`, 20, node.id, "CONDITION_BRANCH_LABEL_REQUIRED");
      }
      if (new Set(labels).size !== labels.length) {
        add("error", "structure", `${node.label}: 중복된 조건 분기 라벨이 있습니다.`, 20, node.id, "CONDITION_BRANCH_LABEL_DUPLICATE");
      }
      const selected = normalizeBranch(node.branchTaken);
      if (selected && !labels.includes(selected)) {
        add("error", "structure", `${node.label}: 선택한 분기 '${selected}'와 일치하는 출력 엣지가 없습니다.`, 20, node.id, "CONDITION_BRANCH_SELECTION_INVALID");
      }
    }
    const engineering = node.engineering ?? {};
    if (((engineering.maxAttempts ?? 1) > 1 || engineering.sideEffect) && !engineering.idempotencyKey?.trim()) {
      add("error", "reliability", `${node.label}: 재시도 또는 부작용 작업에는 idempotency key가 필요합니다.`, 22, node.id, "IDEMPOTENCY_KEY_REQUIRED");
    }
    if (engineering.irreversible && !engineering.compensation?.trim()) {
      add("warning", "reliability", `${node.label}: 비가역 작업의 보상 절차가 정의되지 않았습니다.`, 22, node.id);
    }
    if (engineering.irreversible && graph.engineering?.humanGateForIrreversible !== false) {
      if (!hasApprovedDominatingGate(graph, node.id, executable)) {
        add("error", "security", `${node.label}: 승인 완료 human gate가 모든 실행 경로에서 비가역 작업을 지배해야 합니다.`, 23, node.id, "IRREVERSIBLE_GATE_DOMINATOR_REQUIRED");
      }
    }
    const permissions = new Set(engineering.permissions ?? []);
    if (permissions.has("write") && permissions.has("network") && permissions.has("exec")) {
      add("error", "security", `${node.label}: write+network+exec 권한 결합은 위험 경로입니다.`, 26, node.id);
    }
    if ((engineering.dataClass === "sensitive" || engineering.dataClass === "restricted") && permissions.has("network")) {
      add("error", "security", `${node.label}: ${engineering.dataClass} 데이터는 명시적 정책 예외 없이 network 권한을 사용할 수 없습니다.`, 34, node.id, "SENSITIVE_NETWORK_POLICY_REQUIRED");
    }
    if (engineering.role === "verifier" && engineering.contextMode !== "fresh") {
      add("warning", "context", `${node.label}: 독립 검증자는 fresh context를 사용해야 합니다.`, 24, node.id);
    }
    if ((graph.engineering?.requireProvenance || engineering.evidenceRequired) &&
        (engineering.role === "verifier" || engineering.sideEffect) && !engineering.evidenceRequired) {
      add("warning", "provenance", `${node.label}: 검증/부작용 결과에 증거 요구를 켜세요.`, 15, node.id);
    }
  }

  const structuralEdges = graph.edges.filter((edge) => edge.kind !== "loop");
  for (const edge of graph.edges.filter((item) => item.kind === "loop")) {
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (source?.kind !== "condition") {
      add("error", "structure", `${edge.id}: loop 엣지는 조건 노드에서 시작해야 합니다.`, 20, source?.id, "LOOP_SOURCE_CONDITION_REQUIRED");
    }
    if (!normalizeBranch(edge.branch)) {
      add("error", "structure", `${edge.id}: loop 엣지에 종료 판정과 구별되는 분기 라벨이 필요합니다.`, 20, source?.id, "LOOP_BRANCH_LABEL_REQUIRED");
    }
    if (source && !reachable(edge.to, structuralEdges).has(edge.from)) {
      add("error", "structure", `${edge.id}: loop 엣지는 현재 경로의 선행 노드로 되돌아가야 합니다.`, 20, source.id, "LOOP_BACK_EDGE_REQUIRED");
    }
  }

  const writers = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    for (const key of node.engineering?.writes ?? []) {
      const bucket = writers.get(key) ?? [];
      bucket.push(node);
      writers.set(key, bucket);
    }
  }
  for (const [key, nodes] of writers) {
    const byLevel = new Map<number, GraphNode[]>();
    for (const node of nodes) {
      const level = levels.get(node.id) ?? 0;
      byLevel.set(level, [...(byLevel.get(level) ?? []), node]);
    }
    for (const sameStep of byLevel.values()) {
      if (sameStep.length > 1 && sameStep.some((node) => !node.engineering?.reducer)) {
        add("error", "state", `병렬 노드가 '${key}'에 함께 쓰지만 reducer가 없습니다.`, 19);
      }
    }
  }

  if (graph.edges.some((edge) => edge.kind === "loop")) {
    const missing: string[] = [];
    if (!graph.maxRuns) missing.push("반복 횟수");
    if (!graph.runGuards.maxWallSeconds) missing.push("벽시계 시간");
    if (!graph.runGuards.stagnationRuns) missing.push("정체 감지");
    if (!(graph.runGuards.maxBudgetTokens || graph.engineering?.globalBudgetTokens)) missing.push("토큰 예산");
    if (missing.length) add("error", "operations", `루프 안전장치가 부족합니다: ${missing.join(", ")}.`, 20);
  }
  if ((graph.engineering?.checkpointPolicy ?? "none") === "none"
    && (graph.nodes.length >= 12 || criticalPathNodeIds.length >= 10)) {
    add("warning", "reliability", "장기 그래프에는 superstep 또는 node checkpoint를 권장합니다.", 21);
  }
  if (graph.engineering?.maxParallelism && maxParallelism > graph.engineering.maxParallelism) {
    add("error", "operations", `계획 병렬도 ${maxParallelism}가 제한 ${graph.engineering.maxParallelism}을 초과합니다.`, 33);
  }
  const plannedTokens = graph.nodes.reduce((sum, node) => sum + (node.engineering?.budgetTokens ?? 0), 0);
  const globalBudget = graph.engineering?.globalBudgetTokens ?? graph.runGuards.maxBudgetTokens;
  if (globalBudget && plannedTokens > globalBudget) {
    add("error", "operations", `노드 토큰 예산 합계 ${plannedTokens.toLocaleString()}가 그래프 예산 ${globalBudget.toLocaleString()}을 초과합니다.`, 33);
  }
  if (!graph.engineering?.objective?.trim()) add("info", "operations", "검증 가능한 그래프 목표(objective)를 정의하세요.", 35);
  if (!graph.engineering?.competencyQuestions?.length) add("info", "provenance", "그래프가 답해야 할 competency question을 정의하세요.", 12);
  if (!graph.engineering?.maturity) add("info", "operations", "그래프 설계의 성숙도(standard/de facto/experimental)를 분류하세요.", 35);
  if (criticalPathNodeIds.length > 1) {
    add("info", "operations", `임계 경로는 ${criticalPathNodeIds.length}개 노드입니다. 최적화 시 이 경로를 우선하세요.`, 33);
  }

  const unique = new Map<string, EngineeringFinding>();
  for (const finding of findings) unique.set(`${finding.code ?? ""}:${finding.severity}:${finding.message}:${finding.nodeId ?? ""}`, finding);
  return {
    levels,
    supersteps,
    criticalPathNodeIds,
    loopNodeIds: [...loopNodeIds],
    sourceNodeIds,
    sinkNodeIds,
    depth,
    maxParallelism,
    edgeDensity,
    findings: [...unique.values()],
  };
}

export function validateGraph(graph: GraphDefinition): string[] {
  return analyzeGraph(graph).findings
    .filter((finding) => finding.severity !== "info")
    .map((finding) => finding.message);
}

export function graphCallDefaults(
  parent: GraphDefinition,
  callNode: GraphNode,
  child: GraphDefinition,
): RoutingTarget {
  const mode = callNode.graphCallRoutingMode ?? "child";
  if (mode === "child") return { ...child.defaults };
  if (mode === "inherit") return { ...parent.defaults, ...callNode.routing, ...child.defaults };
  return { ...parent.defaults, ...child.defaults, ...callNode.routing };
}

export function validateGraphLinks(graphs: GraphDefinition[]): GraphLinkFinding[] {
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  const findings: GraphLinkFinding[] = [];
  const adjacency = new Map<string, Array<{ childId: string; nodeId: string }>>();
  for (const graph of graphs) {
    const links: Array<{ childId: string; nodeId: string }> = [];
    for (const node of graph.nodes.filter((item) => item.kind === "graph_call")) {
      if (!node.childGraphId) {
        findings.push({ severity: "error", graphId: graph.id, nodeId: node.id, message: `${node.label}: 호출할 그래프를 선택하지 않았습니다.` });
        continue;
      }
      const child = byId.get(node.childGraphId);
      if (!child) {
        findings.push({ severity: "error", graphId: graph.id, nodeId: node.id, message: `${node.label}: 대상 그래프를 찾을 수 없습니다.` });
        continue;
      }
      if (child.status === "archived") {
        findings.push({ severity: "error", graphId: graph.id, nodeId: node.id, message: `${node.label}: 보관된 그래프 '${child.name}'은 실행할 수 없습니다.` });
      }
      links.push({ childId: child.id, nodeId: node.id });
    }
    adjacency.set(graph.id, links);
  }

  const visiting = new Set<string>();
  const cycleKeys = new Set<string>();
  const walk = (graphId: string, path: string[]): void => {
    if (visiting.has(graphId)) {
      const start = path.indexOf(graphId);
      const cycle = [...path.slice(Math.max(0, start)), graphId];
      const key = [...new Set(cycle)].sort().join(":");
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        const message = `그래프 호출 순환이 있습니다: ${cycle.map((id) => byId.get(id)?.name ?? id).join(" → ")}`;
        for (const id of new Set(cycle)) findings.push({ severity: "error", graphId: id, message });
      }
      return;
    }
    visiting.add(graphId);
    for (const link of adjacency.get(graphId) ?? []) walk(link.childId, [...path, graphId]);
    visiting.delete(graphId);
  };
  for (const graph of graphs) walk(graph.id, []);
  return findings;
}

export function applyTopologyTemplate(graph: GraphDefinition, topology: TopologyKind): GraphDefinition {
  const now = new Date().toISOString();
  const makeNode = (
    suffix: string,
    label: string,
    role: NodeRole,
    x: number,
    y: number,
    kind: NodeKind = "task",
  ): GraphNode => ({
    id: `${graph.id}-${suffix}-${newId("n").slice(-8)}`,
    kind,
    label,
    x,
    y,
    status: "pending",
    joinMode: "all",
    ...(kind === "task" ? { task: { id: newId("task"), title: label, prompt: `${label} 작업을 수행하고 결과와 근거를 기록하세요.` } } : {}),
    ...(kind === "condition" ? { conditionExpr: "이전 결과를 평가해 y 또는 n 분기를 선택하세요." } : {}),
    engineering: {
      role,
      contextMode: role === "verifier" ? "fresh" : "inherit",
      maxAttempts: 1,
      permissions: ["read"],
      evidenceRequired: role === "verifier",
    },
  });
  const connect = (from: GraphNode, to: GraphNode, kind: EdgeKind = "sequence", branch?: string): GraphEdge => ({
    id: newId("edge"), from: from.id, to: to.id, kind, ...(branch ? { branch } : {}),
  });
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  if (topology === "path") {
    const a = makeNode("discover", "입력 분석", "worker", 64, 120);
    const b = makeNode("execute", "작업 수행", "worker", 356, 120);
    const c = makeNode("verify", "독립 검증", "verifier", 648, 120);
    nodes = [a, b, c]; edges = [connect(a, b), connect(b, c)];
  } else if (topology === "diamond") {
    const a = makeNode("plan", "계획", "router", 64, 190);
    const b = makeNode("worker-a", "병렬 작업 A", "worker", 356, 80);
    const c = makeNode("worker-b", "병렬 작업 B", "worker", 356, 300);
    const d = makeNode("merge", "결과 병합", "merge", 648, 190);
    const e = makeNode("verify", "독립 검증", "verifier", 940, 190);
    b.engineering = { ...b.engineering, writes: ["candidate_results"], reducer: "append" };
    c.engineering = { ...c.engineering, writes: ["candidate_results"], reducer: "append" };
    nodes = [a, b, c, d, e]; edges = [connect(a, b), connect(a, c), connect(b, d), connect(c, d), connect(d, e)];
  } else if (topology === "router") {
    const a = makeNode("route", "조건 라우터", "router", 64, 190, "condition");
    const b = makeNode("yes", "Y 경로", "worker", 356, 80);
    const c = makeNode("no", "N 경로", "worker", 356, 300);
    const d = makeNode("merge", "분기 결과 정리", "merge", 648, 190);
    d.joinMode = "any";
    nodes = [a, b, c, d]; edges = [connect(a, b, "sequence", "y"), connect(a, c, "sequence", "n"), connect(b, d), connect(c, d)];
  } else if (topology === "star") {
    const hub = makeNode("supervisor", "Supervisor", "router", 64, 230);
    const workers = ["조사", "구현", "테스트"].map((label, index) => makeNode(`worker-${index}`, label, "worker", 356, 60 + index * 170));
    const merge = makeNode("merge", "통합", "merge", 648, 230);
    nodes = [hub, ...workers, merge]; edges = [...workers.map((node) => connect(hub, node)), ...workers.map((node) => connect(node, merge))];
  } else if (topology === "cycle") {
    const a = makeNode("generate", "생성", "worker", 64, 150);
    const b = makeNode("critic", "비평·판정", "verifier", 356, 150, "condition");
    const c = makeNode("finish", "완료", "merge", 648, 150);
    nodes = [a, b, c]; edges = [connect(a, b), connect(b, a, "loop", "retry"), connect(b, c, "sequence", "done")];
  } else if (topology === "tree") {
    const root = makeNode("root", "문제 분해", "router", 64, 230);
    const a = makeNode("branch-a", "하위 문제 A", "worker", 356, 90);
    const b = makeNode("branch-b", "하위 문제 B", "worker", 356, 370);
    const a1 = makeNode("leaf-a1", "A 조사", "worker", 648, 40);
    const a2 = makeNode("leaf-a2", "A 검증", "verifier", 648, 180);
    const b1 = makeNode("leaf-b1", "B 조사", "worker", 648, 320);
    const b2 = makeNode("leaf-b2", "B 검증", "verifier", 648, 460);
    const merge = makeNode("merge", "계층 결과 병합", "merge", 940, 230);
    nodes = [root, a, b, a1, a2, b1, b2, merge];
    edges = [connect(root, a), connect(root, b), connect(a, a1), connect(a, a2), connect(b, b1), connect(b, b2), connect(a1, merge), connect(a2, merge), connect(b1, merge), connect(b2, merge)];
  } else {
    const agentA = makeNode("agent-a", "수집 Agent", "worker", 64, 100);
    const agentB = makeNode("agent-b", "분석 Agent", "worker", 64, 320);
    const toolA = makeNode("tool-a", "검색 Tool", "tool", 356, 100);
    const toolB = makeNode("tool-b", "실행 Tool", "tool", 356, 320);
    const merge = makeNode("verify", "도구 결과 검증", "verifier", 648, 210);
    toolA.engineering = { ...toolA.engineering, permissions: ["read", "network"] };
    toolB.engineering = { ...toolB.engineering, permissions: ["read", "exec"] };
    nodes = [agentA, agentB, toolA, toolB, merge];
    edges = [connect(agentA, toolA), connect(agentA, toolB), connect(agentB, toolA), connect(agentB, toolB), connect(toolA, merge), connect(toolB, merge)];
  }

  return {
    ...graph,
    status: "draft",
    version: graph.version + 1,
    repeatMode: topology === "cycle" ? "loop" : graph.repeatMode,
    ...(topology === "cycle" ? { maxRuns: graph.maxRuns ?? 3 } : graph.maxRuns ? { maxRuns: graph.maxRuns } : {}),
    runGuards: topology === "cycle"
      ? { ...graph.runGuards, maxWallSeconds: graph.runGuards.maxWallSeconds ?? 1800, stagnationRuns: graph.runGuards.stagnationRuns ?? 2, maxBudgetTokens: graph.runGuards.maxBudgetTokens ?? 100000 }
      : graph.runGuards,
    engineering: {
      checkpointPolicy: "superstep",
      requireProvenance: true,
      humanGateForIrreversible: true,
      maturity: "experimental",
      ...graph.engineering,
      topology,
    },
    nodes,
    edges,
    runs: [],
    updatedAt: now,
  };
}

export function cloneGraph(graph: GraphDefinition, id: string): GraphDefinition {
  const now = new Date().toISOString();
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, `${id}-${node.id}`]));
  return {
    ...structuredClone(graph),
    id,
    name: `${graph.name} 복사본`,
    status: "draft",
    version: 1,
    nodes: graph.nodes.map((node) => {
      const cloned = {
        ...structuredClone(node),
        id: nodeMap.get(node.id) ?? node.id,
        status: "pending" as const,
      };
      delete cloned.branchTaken;
      return cloned;
    }),
    edges: graph.edges.map((edge, index) => ({
      ...edge,
      id: `${id}-edge-${index + 1}`,
      from: nodeMap.get(edge.from) ?? edge.from,
      to: nodeMap.get(edge.to) ?? edge.to,
    })),
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
