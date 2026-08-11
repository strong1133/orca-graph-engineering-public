import {
  commitFolderStore,
  commitStructuredGraph,
  commitStructuredMutation,
  initializeFolderDataSource,
  normalizeDataSourceConfig,
  refreshDataSource,
} from "./data-source.mjs";
import { droppedNodeEngineering } from "./node-engineering.mjs";
import { readTargets } from "./orca.mjs";
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
  return next;
}

function changeSummary(changes) {
  const parts = [];
  if (changes.graphs?.length) parts.push(`그래프 ${changes.graphs.length}`);
  for (const { key } of WORK_COLLECTIONS) {
    if (changes[key]?.length) parts.push(`${key} ${changes[key].length}`);
  }
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
    await writeLocalStore({}, message);
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

export const DISPATCH_LOG_LIMIT = 200;

/**
 * dispatch 기록을 남긴다. 실행 현황 화면이 읽는 값이며, 원천이 아니라 이 장치의
 * 로컬 파일에만 쓴다 — 어디로 보냈는지는 이 장치에서 관측한 사실이다.
 */
export async function recordDispatch(record) {
  const base = dropLegacyRuntimeKeys(await readJson(storePath, defaultStorePath));
  const log = [record, ...(base.dispatchLog ?? []).filter((item) => item.id !== record.id)]
    .slice(0, DISPATCH_LOG_LIMIT);
  await atomicJson(storePath, { ...base, dispatchLog: log });
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
  await updatePanelBootstrap(panelPath, {
    store,
    targets,
    dataSource: projectDataSource(config, sourceCache),
    builtAt: new Date().toISOString(),
  });
  return store;
}
