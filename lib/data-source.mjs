import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SESSION_BOOTSTRAP_BYTES = 1024 * 1024;
const MAX_FOLDER_STORE_BYTES = 10 * 1024 * 1024;
const MAX_CATALOG_ITEMS = 500;
const DEFAULT_TIMEOUT_MS = 8_000;
const ORCA_SESSION_TOKEN_ENV = "ORCA_GRAPH_SOURCE_TOKEN";
/* 세션 bootstrap 은 원천이 base page 에 토큰을 심어 두는 배포에서만 쓸 수 있다.
   토큰을 담은 전역 변수 이름을 설정하지 않으면 bootstrap 자체를 시도하지 않는다. */
function sessionTokenPattern(environment = process.env) {
  const variable = String(environment.ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR || "").trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(variable)) return null;
  const escaped = variable.replaceAll(".", "\\.");
  return new RegExp(`${escaped}\\s*=\\s*"([A-Za-z0-9._~-]{20,4096})"`, "u");
}
export const FOLDER_SOURCE_DIRECTORY = ".orca-graph-engineering";
export const FOLDER_SOURCE_FILENAME = "store.json";

function optionalText(value, field, maxLength = 500) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(`${field} is too long`);
  return normalized;
}

export function normalizeDataSourceConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid data source config");
  if (value.schemaVersion !== 1) throw new Error("unsupported data source config version");
  if (!["local", "folder", "structured", "unstructured"].includes(value.mode)) throw new Error("unsupported data source mode");
  const config = { schemaVersion: 1, mode: value.mode };
  if (value.mode === "local") return config;
  if (value.mode === "folder") {
    const rawFolderPath = optionalText(value.folderPath, "folderPath", 2_000);
    if (!rawFolderPath) throw new Error("folder data source path is required");
    const expanded = rawFolderPath === "~"
      ? homedir()
      : rawFolderPath.startsWith(`~${path.sep}`) ? path.join(homedir(), rawFolderPath.slice(2)) : rawFolderPath;
    if (!path.isAbsolute(expanded)) throw new Error("folder data source path must be absolute");
    const normalized = path.normalize(expanded);
    if (normalized === path.parse(normalized).root) throw new Error("filesystem root cannot be used as a folder data source");
    config.folderPath = normalized;
    return config;
  }
  const rawUrl = optionalText(value.url, "url", 2_000);
  if (!rawUrl) throw new Error("remote data source URL is required");
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("data source URL must use http or https");
  if (url.username || url.password) throw new Error("credentials are not allowed in the data source URL");
  url.hash = "";
  config.url = url.toString();
  const authEnv = optionalText(value.authEnv, "authEnv", 120);
  if (authEnv) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(authEnv)) throw new Error("authEnv must be an uppercase environment variable name");
    config.authEnv = authEnv;
  }
  if (value.mode === "unstructured") {
    for (const field of ["recordsPath", "idField", "titleField", "bodyField"]) {
      const normalized = optionalText(value[field], field, 200);
      if (normalized) config[field] = normalized;
    }
  }
  return config;
}

function requestUrl(config, suffix = "") {
  const base = new URL(config.url);
  if (!suffix) return base;
  if (base.search) throw new Error("structured source base URL must not contain a query string");
  base.pathname = `${base.pathname.replace(/\/+$/u, "")}/${suffix.replace(/^\/+/, "")}`;
  return base;
}

async function responseJson(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("data source response is too large");
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("data source response is too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("data source did not return valid JSON");
  }
}

async function boundedResponseText(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("session bootstrap response is too large");
  const chunks = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("session bootstrap response is too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function bootstrapOrcaSessionToken(config, options) {
  const origin = new URL(config.url);
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(origin, {
      method: "GET",
      headers: { accept: "text/html" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await boundedResponseText(response, MAX_SESSION_BOOTSTRAP_BYTES);
    const pattern = sessionTokenPattern();
    if (!pattern) throw new Error("session bootstrap is not configured; set ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR");
    const token = pattern.exec(html)?.[1];
    if (!token) throw new Error("session token was not advertised by the configured origin");
    process.env[ORCA_SESSION_TOKEN_ENV] = token;
    return token;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("session bootstrap timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBearerToken(config, options) {
  const configured = config.authEnv ? process.env[config.authEnv]?.trim() : "";
  if (configured) return configured;
  if (config.authEnv !== ORCA_SESSION_TOKEN_ENV) {
    throw new Error(`authentication environment variable is missing: ${config.authEnv}`);
  }
  try {
    return await bootstrapOrcaSessionToken(config, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`authentication environment variable is missing: ${config.authEnv} (automatic session bootstrap failed: ${reason})`);
  }
}

export async function requestDataSource(configValue, suffix = "", init = {}, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (["local", "folder"].includes(config.mode)) throw new Error(`${config.mode} mode has no remote endpoint`);
  const url = requestUrl(config, suffix);
  const headers = new Headers(init.headers ?? {});
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (config.authEnv) {
    const token = await resolveBearerToken(config, options);
    headers.set("authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    const body = await responseJson(response);
    if (!response.ok) {
      const detail = body && typeof body === "object" && typeof body.detail === "string" ? body.detail : `HTTP ${response.status}`;
      const error = new Error(`data source request failed: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("data source request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function valueAtPath(root, path) {
  if (!path) return root;
  return path.split(".").filter(Boolean).reduce((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return current[part];
  }, root);
}

function scalar(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function candidateFromRecord(record, index, config, path) {
  const object = record && typeof record === "object" && !Array.isArray(record) ? record : { value: record };
  const idKeys = [config.idField, "id", "key", "uuid"].filter(Boolean);
  const titleKeys = [config.titleField, "title", "name", "label", "subject"].filter(Boolean);
  const bodyKeys = [config.bodyField, "prompt", "content", "description", "text", "body", "memo"].filter(Boolean);
  const first = (keys) => keys.map((key) => scalar(valueAtPath(object, key))).find(Boolean) ?? "";
  const title = first(titleKeys) || first(bodyKeys).slice(0, 120) || `Record ${index + 1}`;
  const body = first(bodyKeys) || title;
  const explicitId = first(idKeys);
  const digest = createHash("sha256").update(`${path}:${index}:${explicitId || title}`).digest("hex").slice(0, 16);
  return {
    id: explicitId || `record-${digest}`,
    kind: "record",
    title,
    body,
    metadata: { sourcePath: path },
  };
}

function discoverRecords(root) {
  const arrays = [];
  const visit = (value, path, depth) => {
    if (arrays.length >= 20 || depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length) arrays.push({ value, path: path || "$" });
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key, depth + 1);
  };
  visit(root, "", 0);
  arrays.sort((left, right) => right.value.length - left.value.length || left.path.localeCompare(right.path));
  return arrays[0] ?? { value: Array.isArray(root) ? root : [root], path: "$" };
}

export function projectUnstructuredJson(payload, configValue) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "unstructured") throw new Error("unstructured projection requires unstructured mode");
  let records;
  let path;
  if (config.recordsPath) {
    records = valueAtPath(payload, config.recordsPath);
    path = config.recordsPath;
    if (!Array.isArray(records)) throw new Error(`recordsPath is not an array: ${config.recordsPath}`);
  } else {
    const discovered = discoverRecords(payload);
    records = discovered.value;
    path = discovered.path;
  }
  return records.slice(0, MAX_CATALOG_ITEMS).map((record, index) => candidateFromRecord(record, index, config, path));
}

function validateStructuredSnapshot(value) {
  if (!value || typeof value !== "object" || value.contractVersion !== 1) throw new Error("unsupported structured source contract");
  if (!value.store || value.store.schemaVersion !== 1 || !Array.isArray(value.store.graphs)) throw new Error("structured source snapshot has no valid graph store");
  if (!value.catalog || !Array.isArray(value.catalog.tasks) || !Array.isArray(value.catalog.todos)) throw new Error("structured source snapshot has no valid catalog");
  const mutable = ["domainMutation", "milestoneMutation", "taskMutation", "todoMutation"].some((key) => value.capabilities?.[key] === true);
  if (mutable && !["domains", "milestones", "tasks", "todos"].every((key) => Array.isArray(value.store[key]))) {
    throw new Error("mutation-capable structured source must return all work collections");
  }
  return value;
}

function validateFolderStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !Array.isArray(value.graphs)) {
    throw new Error("folder data source has no valid GraphStore v1");
  }
  for (const key of ["domains", "milestones", "tasks", "todos"]) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error(`folder data source has an invalid ${key} collection`);
  }
  return value;
}

function portableFolderStore(store) {
  const {
    saveTerminalId: _saveTerminalId,
    lastSaveMessage: _lastSaveMessage,
    lastSavedAt: _lastSavedAt,
    ...portable
  } = validateFolderStore(store);
  return portable;
}

export function folderSourceStorePath(configValue) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "folder") throw new Error("folder store path requires folder mode");
  return path.join(config.folderPath, FOLDER_SOURCE_DIRECTORY, FOLDER_SOURCE_FILENAME);
}

async function folderSourceDetails(configValue) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "folder") throw new Error("folder source details require folder mode");
  let folderStats;
  try {
    folderStats = await stat(config.folderPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`folder data source path does not exist: ${config.folderPath}`);
    throw error;
  }
  if (!folderStats.isDirectory()) throw new Error(`folder data source path is not a directory: ${config.folderPath}`);
  const storageDirectory = path.join(config.folderPath, FOLDER_SOURCE_DIRECTORY);
  try {
    const storageStats = await lstat(storageDirectory);
    if (storageStats.isSymbolicLink()) throw new Error("folder data source storage directory must not be a symbolic link");
    if (!storageStats.isDirectory()) throw new Error("folder data source storage path is not a directory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let git = false;
  try {
    const gitStats = await lstat(path.join(config.folderPath, ".git"));
    git = gitStats.isDirectory() || gitStats.isFile();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { config, storageDirectory, storePath: folderSourceStorePath(config), git };
}

async function readFolderStore(configValue) {
  const details = await folderSourceDetails(configValue);
  let fileStats;
  try {
    fileStats = await lstat(details.storePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`folder data source is not initialized: ${details.storePath}`);
    throw error;
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) throw new Error("folder data source store must be a regular file");
  if (fileStats.size > MAX_FOLDER_STORE_BYTES) throw new Error("folder data source store is too large");
  let value;
  try {
    value = JSON.parse(await readFile(details.storePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("folder data source store is not valid JSON");
    throw error;
  }
  return { ...details, store: validateFolderStore(value) };
}

export async function commitFolderStore(configValue, store) {
  const details = await folderSourceDetails(configValue);
  const portable = portableFolderStore(store);
  await mkdir(details.storageDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(details.storageDirectory, `${FOLDER_SOURCE_FILENAME}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(portable, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, details.storePath);
  } finally {
    await unlink(temporary).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  }
  return portable;
}

export async function initializeFolderDataSource(configValue, seedStore) {
  const details = await folderSourceDetails(configValue);
  try {
    return (await readFolderStore(details.config)).store;
  } catch (error) {
    if (!String(error?.message ?? error).startsWith("folder data source is not initialized:")) throw error;
  }
  if (!seedStore) throw new Error("folder data source requires an initial GraphStore");
  return commitFolderStore(details.config, seedStore);
}

export async function refreshDataSource(configValue, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode === "local") {
    return { schemaVersion: 1, mode: "local", status: "idle", catalog: [], message: "로컬 JSON 저장소를 사용합니다." };
  }
  const refreshedAt = new Date().toISOString();
  if (config.mode === "folder") {
    const details = await readFolderStore(config);
    const store = details.store;
    return {
      schemaVersion: 1,
      mode: "folder",
      status: "ready",
      source: {
        id: `folder-${createHash("sha256").update(details.config.folderPath).digest("hex").slice(0, 16)}`,
        name: `${path.basename(details.config.folderPath) || details.config.folderPath}${details.git ? " · Git" : " · Folder"}`,
      },
      refreshedAt,
      store,
      catalog: [],
      capabilities: {
        graphCommit: true,
        domainMutation: true,
        milestoneMutation: true,
        taskMutation: true,
        todoMutation: true,
        promptMutation: true,
        todoTaskBinding: "mutable",
        taskCatalog: true,
        todoCatalog: true,
      },
      message: `${store.graphs.length} graphs · ${store.tasks?.length ?? 0} tasks · ${store.todos?.length ?? 0} todos · ${details.git ? "Git storage" : "folder storage"}`,
    };
  }
  if (config.mode === "structured") {
    const snapshot = validateStructuredSnapshot(await requestDataSource(config, "orca-graph-source/v1/snapshot", {}, options));
    return {
      schemaVersion: 1,
      mode: "structured",
      status: "ready",
      source: snapshot.source ?? { id: "structured-source", name: "Structured workspace" },
      refreshedAt,
      store: snapshot.store,
      catalog: [...snapshot.catalog.tasks, ...snapshot.catalog.todos],
      capabilities: snapshot.capabilities ?? { graphCommit: true, taskCatalog: true, todoCatalog: true },
      message: `${snapshot.store.graphs.length} graphs · ${snapshot.catalog.tasks.length} tasks · ${snapshot.catalog.todos.length} todos`,
    };
  }
  const payload = await requestDataSource(config, "", {}, options);
  const catalog = projectUnstructuredJson(payload, config);
  return {
    schemaVersion: 1,
    mode: "unstructured",
    status: "ready",
    source: { id: "unstructured-source", name: new URL(config.url).hostname },
    refreshedAt,
    catalog,
    capabilities: { graphCommit: false, taskCatalog: true, todoCatalog: false },
    message: `${catalog.length} records · read-only catalog`,
  };
}

export async function commitStructuredGraph(configValue, graph, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "structured") throw new Error("graph commit requires structured mode");
  if (!graph || typeof graph !== "object" || typeof graph.id !== "string") throw new Error("invalid graph commit payload");
  const result = await requestDataSource(
    config,
    `orca-graph-source/v1/graphs/${encodeURIComponent(graph.id)}/commit`,
    { method: "POST", body: JSON.stringify({ contractVersion: 1, expectedVersion: graph.version, graph }) },
    options,
  );
  if (!result || result.contractVersion !== 1 || !result.graph) throw new Error("structured source returned an invalid graph commit response");
  return result.graph;
}

/* 원격 실행 capability — 없으면 null이고 호출부는 예전처럼 fail-closed한다.
   구조를 모르는 값이나 빈 nodeKinds를 "실행해도 좋다"로 읽지 않는다. */
export function structuredExecutionCapability(capabilities) {
  const execution = capabilities?.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) return null;
  if (execution.mode !== "remote-claim") return null;
  const nodeKinds = Array.isArray(execution.nodeKinds)
    ? execution.nodeKinds.filter((kind) => typeof kind === "string" && kind.trim())
    : [];
  if (!nodeKinds.length) return null;
  const lease = Number(execution.claimLeaseSeconds);
  return {
    mode: "remote-claim",
    nodeKinds,
    claimLeaseSeconds: Number.isFinite(lease) && lease > 0 ? Math.floor(lease) : null,
  };
}

function validateExecutionFrontier(value) {
  if (!value || typeof value !== "object" || value.contractVersion !== 1) {
    throw new Error("unsupported structured source execution contract");
  }
  if (!value.graph || typeof value.graph.id !== "string" || !Number.isInteger(value.graph.version)) {
    throw new Error("structured source execution response has no graph identity");
  }
  if (!Array.isArray(value.nodes)) throw new Error("structured source execution response has no node frontier");
  return value;
}

function executionPath(graphId) {
  return `orca-graph-source/v1/graphs/${encodeURIComponent(graphId)}/execution`;
}

function nodePath(graphId, nodeId, action) {
  return `orca-graph-source/v1/graphs/${encodeURIComponent(graphId)}/nodes/${encodeURIComponent(nodeId)}/${action}`;
}

export async function fetchStructuredExecution(configValue, graphId, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "structured") throw new Error("remote execution requires structured mode");
  if (typeof graphId !== "string" || !graphId) throw new Error("remote execution requires a graph id");
  return validateExecutionFrontier(await requestDataSource(config, executionPath(graphId), {}, options));
}

export async function claimStructuredNode(configValue, graphId, nodeId, expectedVersion, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "structured") throw new Error("remote claim requires structured mode");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("remote claim requires the graph version last read");
  const result = await requestDataSource(
    config,
    nodePath(graphId, nodeId, "claim"),
    { method: "POST", body: JSON.stringify({ contractVersion: 1, expectedVersion }) },
    options,
  );
  if (!result || result.contractVersion !== 1 || !result.graph || !result.node) {
    throw new Error("structured source returned an invalid claim response");
  }
  return result;
}

export async function completeStructuredNode(configValue, graphId, nodeId, outcome, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "structured") throw new Error("remote completion requires structured mode");
  if (!outcome || !["done", "skipped", "failed"].includes(outcome.result)) {
    throw new Error("remote completion requires a done, skipped, or failed result");
  }
  if (!Number.isInteger(outcome.expectedVersion) || outcome.expectedVersion < 1) {
    throw new Error("remote completion requires the graph version last read");
  }
  const result = await requestDataSource(
    config,
    nodePath(graphId, nodeId, "complete"),
    {
      method: "POST",
      body: JSON.stringify({
        contractVersion: 1,
        expectedVersion: outcome.expectedVersion,
        result: outcome.result,
        ...(outcome.branch ? { branch: outcome.branch } : {}),
        ...(outcome.note ? { note: outcome.note } : {}),
        ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
      }),
    },
    options,
  );
  if (!result || result.contractVersion !== 1 || !result.graph) {
    throw new Error("structured source returned an invalid completion response");
  }
  return result;
}

export async function commitStructuredMutation(configValue, mutation, options = {}) {
  const config = normalizeDataSourceConfig(configValue);
  if (config.mode !== "structured") throw new Error("source mutation requires structured mode");
  if (!mutation || typeof mutation !== "object" || !["domain", "milestone", "task", "todo"].includes(mutation.kind)) {
    throw new Error("invalid source mutation payload");
  }
  if (!Number.isInteger(mutation.expectedVersion) || mutation.expectedVersion < 0 || !mutation.item || typeof mutation.item !== "object") {
    throw new Error("source mutation requires an item and non-negative expectedVersion");
  }
  const result = await requestDataSource(
    config,
    "orca-graph-source/v1/mutations",
    { method: "POST", body: JSON.stringify({ contractVersion: 1, operation: "upsert", relatedVersions: {}, ...mutation }) },
    options,
  );
  if (!result || result.contractVersion !== 1 || result.kind !== mutation.kind || !result.item) {
    throw new Error("structured source returned an invalid mutation response");
  }
  return result.item;
}
