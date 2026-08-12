import {
  commitFolderStore,
  commitStructuredGraph,
  commitStructuredMutation,
  initializeFolderDataSource,
  normalizeDataSourceConfig,
  refreshDataSource,
} from "./data-source.mjs";
import { droppedNodeEngineering } from "./node-engineering.mjs";
import { readTargets, runOrca } from "./orca.mjs";
import { updatePanelBootstrap } from "../scripts/panel-bootstrap.mjs";
import {
  atomicJson,
  dataSourcePath,
  defaultDataSourcePath,
  defaultSourceCachePath,
  defaultStorePath,
  panelPath,
  readJson,
  sourceCachePath,
  storePath,
} from "./paths.mjs";

/** 항목 컬렉션과 그 원천 mutation 종류. 그래프는 aggregate라 따로 커밋한다. */
const WORK_COLLECTIONS = [
  { key: "domains", kind: "domain" },
  { key: "milestones", kind: "milestone" },
  { key: "tasks", kind: "task" },
  { key: "todos", kind: "todo" },
];

/**
 * 예전 브리지 시절의 런타임 키를 떨어뜨린다. 남겨 두면 저장할 때마다 파일과 패널
 * bootstrap에 죽은 값이 실려 다니고, 무엇이 현재 계약인지 읽기 어려워진다.
 */
export function dropLegacyRuntimeKeys(store) {
  const {
    bridgeTerminalId: _terminal, bridgeWorkspace: _workspace,
    lastBridgeMessage: _message, lastBridgeAt: _at,
    ...current
  } = store ?? {};
  return current;
}

export function storeBackedSource(mode) {
  return mode === "structured" || mode === "folder";
}

export async function readDataSourceConfig() {
  return normalizeDataSourceConfig(await readJson(dataSourcePath, defaultDataSourcePath));
}

/** 원천 스냅샷 위에 이 장치에서만 의미 있는 값(마지막 저장 표시)을 얹는다. */
function withLocalRuntime(sourceStore, localStore) {
  return {
    ...sourceStore,
    ...(localStore?.saveTerminalId ? { saveTerminalId: localStore.saveTerminalId } : {}),
    ...(localStore?.panelView ? { panelView: localStore.panelView } : {}),
    ...(localStore?.lastSaveMessage ? { lastSaveMessage: localStore.lastSaveMessage } : {}),
    ...(localStore?.lastSavedAt ? { lastSavedAt: localStore.lastSavedAt } : {}),
    dispatchLog: localStore?.dispatchLog ?? [],
  };
}

function replaceById(collection, incoming) {
  if (!incoming?.length) return collection ?? [];
  const byId = new Map((collection ?? []).map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * 패널이 보낸 변경분을 로컬 store에 얹는다. 저장 버튼이 보내는 것은 store 전체가
 * 아니라 바뀐 항목뿐이므로, 여기서 통째 교체를 하면 다른 화면의 편집이 사라진다.
 */
function mergeChanges(base, changes) {
  const next = { ...base };
  // 지운 항목은 변경분에 실리지 않는다. 따로 알려 준 id를 여기서 떨어뜨린다.
  const deletedDispatchIds = new Set(changes.deletions?.dispatchIds ?? []);
  if (deletedDispatchIds.size) {
    next.dispatchLog = (next.dispatchLog ?? []).filter((record) => !deletedDispatchIds.has(record.id));
  }
  const deletedGraphs = new Set(changes.deletions?.graphs ?? []);
  if (deletedGraphs.size) {
    next.graphs = (next.graphs ?? []).filter((graph) => !deletedGraphs.has(graph.id));
    if (deletedGraphs.has(next.activeGraphId)) next.activeGraphId = next.graphs?.[0]?.id ?? "";
  }
  const deletedTasks = new Set(changes.deletions?.tasks ?? []);
  if (deletedTasks.size) {
    next.tasks = (next.tasks ?? []).filter((task) => !deletedTasks.has(task.id));
    next.todos = (next.todos ?? []).map((todo) => {
      if (!todo.taskId || !deletedTasks.has(todo.taskId)) return todo;
      const { taskId: _dropped, ...rest } = todo;
      return rest;
    });
  }
  if (changes.graphs?.length) next.graphs = replaceById(next.graphs, changes.graphs);
  for (const { key } of WORK_COLLECTIONS) {
    if (changes[key]?.length) next[key] = replaceById(next[key], changes[key]);
  }
  if (typeof changes.activeGraphId === "string" && changes.activeGraphId) {
    next.activeGraphId = changes.activeGraphId;
  }
  if (typeof changes.saveTerminalId === "string" && changes.saveTerminalId) {
    next.saveTerminalId = changes.saveTerminalId;
  }
  // 패널을 다시 열었을 때 돌아갈 화면. 패널에는 저장소가 없어 여기에 남긴다.
  if (changes.panelView && typeof changes.panelView === "object") next.panelView = changes.panelView;
  return next;
}

function changeSummary(changes) {
  const parts = [];
  if (changes.graphs?.length) parts.push(`그래프 ${changes.graphs.length}`);
  for (const { key } of WORK_COLLECTIONS) {
    if (changes[key]?.length) parts.push(`${key} ${changes[key].length}`);
  }
  if (changes.deletions?.tasks?.length) parts.push(`tasks 삭제 ${changes.deletions.tasks.length}`);
  if (changes.deletions?.graphs?.length) parts.push(`그래프 삭제 ${changes.deletions.graphs.length}`);
  if (changes.deletions?.dispatchIds?.length) parts.push(`실행 기록 삭제 ${changes.deletions.dispatchIds.length}`);
  return parts.length ? parts.join(" · ") : "변경 없음";
}

export function validateChanges(changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("invalid save payload");
  }
  for (const key of ["graphs", ...WORK_COLLECTIONS.map((entry) => entry.key)]) {
    const value = changes[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || typeof item.id !== "string")) {
      throw new Error(`invalid ${key} in save payload`);
    }
  }
  for (const key of ["tasks", "graphs", "dispatchIds"]) {
    const value = changes.deletions?.[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id))) {
      throw new Error(`invalid deletions.${key} in save payload`);
    }
  }
  return changes;
}

async function writeLocalStore(changes, message) {
  const base = dropLegacyRuntimeKeys(await readJson(storePath, defaultStorePath));
  const next = mergeChanges(base, changes);
  next.lastSaveMessage = message;
  next.lastSavedAt = new Date().toISOString();
  await atomicJson(storePath, next);
  return next;
}

/**
 * 저장의 정본 경계. 데이터 원천이 연결되어 있으면 원천으로 보내고, 없을 때만
 * 로컬 파일에 쓴다. 원천 응답이 정본이므로 저장 뒤에는 반드시 다시 읽는다.
 */
export async function saveChanges(rawChanges) {
  const changes = validateChanges(rawChanges);
  const config = await readDataSourceConfig();
  const message = `저장했습니다 · ${changeSummary(changes)}`;
  const warnings = [];

  if (config.mode === "structured") {
    for (const graph of changes.graphs ?? []) {
      const committed = await commitStructuredGraph(config, graph);
      const dropped = droppedNodeEngineering(graph, committed);
      if (dropped.length) {
        warnings.push(`이 데이터 원천이 노드 실행 계약을 보존하지 않았습니다 (${dropped.join(" / ")}). 해당 노드의 승인 게이트·재시도·권한 검사는 실행 시 적용되지 않습니다.`);
      }
    }
    for (const { key, kind } of WORK_COLLECTIONS) {
      for (const item of changes[key] ?? []) {
        await commitStructuredMutation(config, {
          kind,
          expectedVersion: Number.isInteger(item.version) ? item.version : 0,
          item,
        });
      }
    }
    // dispatch 기록과 화면은 이 장치의 것이다. 원천 모드에서도 그대로 반영한다.
    await writeLocalStore({
      ...(changes.panelView ? { panelView: changes.panelView } : {}),
      ...(changes.deletions?.dispatchIds?.length ? { deletions: { dispatchIds: changes.deletions.dispatchIds } } : {}),
    }, message);
    const cache = await refreshSource(config, changes.activeGraphId);
    return { mode: "structured", store: cache.store, dataSource: cache.dataSource, warnings };
  }

  const localStore = await writeLocalStore(changes, message);
  if (config.mode === "folder") {
    await commitFolderStore(config, localStore);
    const cache = await refreshSource(config, changes.activeGraphId);
    return { mode: "folder", store: cache.store, dataSource: cache.dataSource, warnings };
  }
  return { mode: config.mode, store: localStore, warnings };
}

/**
 * 전용 터미널의 handle을 이 장치의 로컬 store에 남긴다. 패널은 열릴 때 이 값을
 * bootstrap으로 받아, 어디로 명령을 보낼지 묻지 않고 그대로 쓴다.
 */
export async function recordSaveTerminal(terminalId) {
  if (!terminalId) return null;
  const base = dropLegacyRuntimeKeys(await readJson(storePath, defaultStorePath));
  if (base.saveTerminalId === terminalId) return terminalId;
  await atomicJson(storePath, { ...base, saveTerminalId: terminalId });
  return terminalId;
}

/**
 * 화면에서 결과 줄을 찾는다.
 *
 * 프롬프트가 요구하는 계약은 마지막 응답 첫 줄이 `RESULT: done` 또는
 * `RESULT: failed — 사유`로 시작하는 것이다. 프롬프트 자체에도 그 문자열이 들어
 * 있으므로(백틱으로 감싼 설명문) 그 줄은 결과로 세지 않는다.
 */
export function parseResultLine(tail) {
  const lines = String(tail ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.includes("`")) continue;
    const match = /^[^A-Za-z]{0,4}RESULT:\s*(done|failed)\b[\s:—-]*(.*)$/iu.exec(line);
    if (!match) continue;
    return {
      status: match[1].toLowerCase() === "done" ? "done" : "failed",
      ...(match[2]?.trim() ? { message: match[2].trim().slice(0, 400) } : {}),
    };
  }
  return null;
}

/**
 * 화면에서 노드별 진행 줄을 찾는다.
 *
 * 그래프 실행은 세션 하나가 노드를 이어서 돈다. 그 세션이 노드를 마칠 때마다
 * `NODE <id> running`과 `NODE <id> <done|failed|skipped> <요약>`을 남기게 되어 있고,
 * 여기서 그것을 읽는다. 같은 노드를 여러 번 보고하면 마지막 줄이 이긴다.
 * 프롬프트 본문에도 형식 설명이 있으므로 `<`가 들어간 줄은 세지 않는다.
 */
export function parseNodeStates(tail) {
  const states = {};
  for (const raw of String(tail ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.includes("<") || line.includes("`")) continue;
    const match = /^[^A-Za-z]{0,4}NODE[:\s]+([A-Za-z0-9_.:-]+)\s+(running|done|failed|skipped)\b[\s:—-]*(.*)$/iu.exec(line);
    if (!match) continue;
    // TUI는 같은 화면 줄에 스피너를 덧그린다. 그 찌꺼기가 요약 뒤에 붙어 온다.
    const summary = (match[3] ?? "").split("•")[0].trim();
    states[match[1]] = {
      status: match[2].toLowerCase(),
      ...(summary ? { message: summary.slice(0, 300) } : {}),
    };
  }
  return states;
}

/** 갱신할 때 살펴볼 최근 기록 수. 전부 읽으면 갱신이 느려진다. */
const OUTCOME_SCAN_LIMIT = 30;

/**
 * 보낸 세션들의 결과를 관측해 기록에 얹는다.
 *
 * 세션이 살아 있는데 결과 줄이 없으면 진행 중, 결과 줄이 있으면 성공/실패,
 * 세션이 사라졌으면 닫힘이다. 어느 쪽도 추정이 아니라 그때 화면에서 읽은 것이다.
 */
export async function refreshDispatchOutcomes() {
  const base = dropLegacyRuntimeKeys(await readJson(storePath, defaultStorePath));
  const log = base.dispatchLog ?? [];
  if (!log.length) return { scanned: 0, log };
  const observedAt = new Date().toISOString();
  const bySession = new Map();
  for (const record of log.slice(0, OUTCOME_SCAN_LIMIT)) {
    for (const target of record.targets ?? []) {
      if (target.sessionId && !bySession.has(target.sessionId)) bySession.set(target.sessionId, null);
    }
  }
  await Promise.all([...bySession.keys()].map(async (sessionId) => {
    try {
      const read = await runOrca(["terminal", "read", "--terminal", sessionId]);
      const tail = (read?.terminal?.tail ?? []).join("\n");
      const parsed = parseResultLine(tail);
      bySession.set(sessionId, {
        ...(parsed ?? { status: "running" }),
        nodeStates: parseNodeStates(tail),
        observedAt,
      });
    } catch {
      // 세션이 사라졌다. 결과를 남기지 않고 끝난 것과 구분해서 표시한다.
      bySession.set(sessionId, { status: "closed", observedAt });
    }
  }));
  const next = log.map((record) => ({
    ...record,
    targets: (record.targets ?? []).map((target) => {
      const observed = target.sessionId ? bySession.get(target.sessionId) : null;
      if (!observed) return target;
      const { nodeStates, ...outcome } = observed;
      return {
        ...target,
        outcome,
        ...(nodeStates && Object.keys(nodeStates).length ? { nodeStates } : {}),
      };
    }),
  }));
  await atomicJson(storePath, { ...base, dispatchLog: next });
  return { scanned: bySession.size, log: next };
}

export const DISPATCH_LOG_LIMIT = 200;

/**
 * dispatch 기록을 남긴다. 실행 현황 화면이 읽는 값이며, 원천이 아니라 이 장치의
 * 로컬 파일에만 쓴다 — 어디로 보냈는지는 이 장치에서 관측한 사실이다.
 */
export async function recordDispatch(record, panelView) {
  const base = dropLegacyRuntimeKeys(await readJson(storePath, defaultStorePath));
  const log = [record, ...(base.dispatchLog ?? []).filter((item) => item.id !== record.id)]
    .slice(0, DISPATCH_LOG_LIMIT);
  await atomicJson(storePath, {
    ...base,
    ...(panelView && typeof panelView === "object" ? { panelView } : {}),
    dispatchLog: log,
  });
  return record;
}

/** 원천을 다시 읽어 캐시에 남기고, 로컬 표시값을 얹은 working store를 돌려준다. */
export async function refreshSource(config, preferredGraphId = "") {
  config ??= await readDataSourceConfig();
  const cache = await refreshDataSource(config);
  if (preferredGraphId && cache.store?.graphs?.some((graph) => graph.id === preferredGraphId)) {
    cache.store.activeGraphId = preferredGraphId;
  }
  await atomicJson(sourceCachePath, cache);
  const localStore = await readJson(storePath, defaultStorePath);
  const store = storeBackedSource(config.mode) && cache.store?.schemaVersion === 1
    ? withLocalRuntime(cache.store, localStore)
    : localStore;
  return { store, dataSource: projectDataSource(config, cache) };
}

export async function configureSource(rawConfig, seedStore) {
  const config = normalizeDataSourceConfig(rawConfig);
  if (config.mode === "folder") {
    await initializeFolderDataSource(config, seedStore ?? await readJson(storePath, defaultStorePath));
  }
  await atomicJson(dataSourcePath, config);
  return refreshSource(config);
}

function projectDataSource(config, cache) {
  return {
    config,
    status: cache.mode === config.mode ? cache.status : "idle",
    ...(cache.source ? { source: cache.source } : {}),
    ...(cache.refreshedAt ? { refreshedAt: cache.refreshedAt } : {}),
    ...(cache.message ? { message: cache.message } : {}),
    catalog: cache.mode === config.mode ? cache.catalog ?? [] : [],
    ...(cache.capabilities ? { capabilities: cache.capabilities } : {}),
  };
}

/**
 * 패널의 유일한 읽기 채널. 패널 iframe은 네트워크도 파일도 없으므로, 최신 데이터를
 * panel.html의 bootstrap JSON에 직접 박아 둔다. Orca는 패널을 열 때마다 이 파일을
 * 다시 읽으므로 다음에 패널을 열면 반영된다.
 *
 * 아직 빌드하지 않아 패널 파일이 없으면 건너뛰고 false를 돌려준다. 저장은 이미
 * 끝났고 정본은 런타임 파일에 있다 — 스냅샷을 싣지 못했다고 저장을 실패로 접으면
 * 방금 한 편집이 실패한 것처럼 보인다.
 */
export async function writePanelSnapshot() {
  const config = await readDataSourceConfig();
  const [localStore, targets, sourceCache] = await Promise.all([
    readJson(storePath, defaultStorePath),
    readTargets(),
    readJson(sourceCachePath, defaultSourceCachePath),
  ]);
  const useSourceStore = storeBackedSource(config.mode)
    && sourceCache.mode === config.mode
    && sourceCache.status === "ready"
    && sourceCache.store?.schemaVersion === 1;
  const store = useSourceStore ? withLocalRuntime(sourceCache.store, localStore) : dropLegacyRuntimeKeys(localStore);
  try {
    await updatePanelBootstrap(panelPath, {
      store,
      targets,
      dataSource: projectDataSource(config, sourceCache),
      builtAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
  return true;
}
