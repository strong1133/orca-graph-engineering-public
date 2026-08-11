/* 외부 workspace 원천 클라이언트.

   여기에는 특정 배포처의 이름·주소·토큰 규칙을 넣지 않는다. 전부 설정으로 받고,
   설정이 없으면 그 기능을 켜지 않는다. 어떤 조직이든 자기 값을 넣어 쓰는 것이
   목표이지, 누군가의 설치본이 기본값이 되는 것이 아니다. */

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SENSITIVE_KEYS = new Set(["authorization", "body", "content", "draft", "input", "input_prompt", "meta_prompt", "password", "prompt", "secret", "token"]);
const DEFAULT_API_PATH = "/api/plugins/orca-graph-engineering";
const DEFAULT_CLIENT_HEADER = "X-Orca-Graph-Client";
const DEFAULT_SESSION_HEADER = "X-Session-Token";

function workspaceSessionHeader(environment = process.env) {
  const configured = String(environment.ORCA_GRAPH_WORKSPACE_SESSION_HEADER || "").trim();
  return configured || DEFAULT_SESSION_HEADER;
}

function workspaceApiPath(environment = process.env) {
  const configured = String(environment.ORCA_GRAPH_WORKSPACE_API_PATH || "").trim();
  return configured || DEFAULT_API_PATH;
}

function workspaceClientHeader(environment = process.env) {
  const configured = String(environment.ORCA_GRAPH_WORKSPACE_CLIENT_HEADER || "").trim();
  return configured || DEFAULT_CLIENT_HEADER;
}

/* 세션 bootstrap은 원천이 base page에 토큰을 심어 두는 배포에서만 쓸 수 있다.
   전역 변수 이름을 설정하지 않으면 bootstrap 자체를 시도하지 않는다. */
function sessionTokenPattern(environment = process.env) {
  const variable = String(environment.ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR || "").trim();
  // window.__X__ 처럼 전역 경로도 받는다. 정규식 메타문자가 섞이면 만들지 않는다.
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(variable)) return null;
  const escaped = variable.replaceAll(".", "\\.");
  return new RegExp(`${escaped}="(?<value>[A-Za-z0-9._~-]{20,})"`, "u");
}

export class WorkTasksClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "WorkTasksClientError";
    if (options.status !== undefined) this.status = options.status;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

function sanitize(value, key = "") {
  if (SENSITIVE_KEYS.has(String(key).toLowerCase())) return "[REDACTED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]));
  return typeof value === "string" ? value.slice(0, 500) : value;
}

export function validateWorkTasksBaseUrl(value, { allowInsecureLoopback = false } = {}) {
  const normalized = String(value || "").trim().replace(/\/+$/u, "");
  if (!normalized) throw new WorkTasksClientError("the workspace API base URL is required");
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new WorkTasksClientError("the workspace API base URL is invalid"); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new WorkTasksClientError("the workspace API base URL must not contain credentials, query parameters, or fragments");
  }
  const secure = parsed.protocol === "https:";
  const loopback = allowInsecureLoopback && parsed.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (!secure && !loopback) {
    throw new WorkTasksClientError("the workspace API base URL must be HTTPS (or an explicitly enabled loopback test URL)");
  }
  return normalized;
}

export function workTasksEnvironment(value, localName = "") {
  // 이 장치가 어떤 실행 환경으로 불릴지는 사용자가 정한다. 알려진 이름 목록을
  // 코드가 들고 있으면 그 목록에 없는 설치본은 쓸 수 없다.
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  const local = String(localName || "").trim();
  return local || null;
}

export function mapOrcaRepos(value, worktreeValue = {}) {
  const repos = Array.isArray(value?.repos) ? value.repos : [];
  const worktrees = Array.isArray(worktreeValue?.worktrees) ? worktreeValue.worktrees : [];
  if (worktrees.length > 5_000) throw new WorkTasksClientError("Orca worktree list exceeds the workspace registry limit of 5000 worktrees");
  const worktreesByRepo = new Map();
  for (const worktree of worktrees) {
    if (worktree?.isArchived) continue;
    const repoId = typeof worktree?.repoId === "string" ? worktree.repoId : "";
    const id = typeof worktree?.id === "string" ? worktree.id : "";
    const worktreePath = typeof worktree?.path === "string" ? worktree.path : "";
    if (!repoId || !id || !worktreePath) continue;
    if (id.length > 500) throw new WorkTasksClientError("Orca worktree id exceeds 500 characters");
    if (worktreePath.length > 4096) throw new WorkTasksClientError("Orca worktree path exceeds 4096 characters");
    if (typeof worktree.displayName === "string" && worktree.displayName.length > 200) {
      throw new WorkTasksClientError("Orca worktree displayName exceeds 200 characters");
    }
    const branch = normalizeWorkBranch(worktree.branch);
    const mapped = {
      id,
      path: worktreePath,
      ...(branch ? { branch } : {}),
      ...(typeof worktree.displayName === "string" && worktree.displayName ? { display_name: worktree.displayName } : {}),
      ...(worktree.isMainWorktree === true ? { is_main: true } : {}),
    };
    const current = worktreesByRepo.get(repoId) ?? [];
    if (current.length >= 500) throw new WorkTasksClientError(`Orca repository ${repoId} exceeds 500 worktrees`);
    current.push(mapped);
    worktreesByRepo.set(repoId, current);
  }
  const projects = repos.flatMap((repo) => {
    const name = typeof repo?.displayName === "string" ? repo.displayName : "";
    const repoPath = typeof repo?.path === "string" ? repo.path : "";
    if (!name || !repoPath) return [];
    if (name.length > 200) throw new WorkTasksClientError("Orca repository displayName exceeds 200 characters");
    if (repoPath.length > 4096) throw new WorkTasksClientError("Orca repository path exceeds 4096 characters");
    if (typeof repo.kind === "string" && repo.kind.length > 40) throw new WorkTasksClientError("Orca repository kind exceeds 40 characters");
    if (typeof repo.id === "string" && repo.id.length > 200) throw new WorkTasksClientError("Orca repository id exceeds 200 characters");
    if (typeof repo.gitRemoteIdentity?.canonicalKey === "string" && repo.gitRemoteIdentity.canonicalKey.length > 500) {
      throw new WorkTasksClientError("Orca repository remote identity exceeds 500 characters");
    }
    return [{
      name,
      path: repoPath,
      ...(typeof repo.kind === "string" && repo.kind ? { kind: repo.kind } : {}),
      ...(typeof repo.id === "string" && repo.id ? { repo_id: repo.id } : {}),
      ...(typeof repo.gitRemoteIdentity?.canonicalKey === "string" && repo.gitRemoteIdentity.canonicalKey
        ? { remote: repo.gitRemoteIdentity.canonicalKey } : {}),
      ...((worktreesByRepo.get(repo.id) ?? []).length ? { worktrees: worktreesByRepo.get(repo.id) } : {}),
    }];
  });
  if (projects.length > 500) throw new WorkTasksClientError("Orca repo list exceeds the workspace registry limit of 500 projects");
  return projects;
}

export function normalizeWorkBranch(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new WorkTasksClientError("Task project branch must be a string");
  const branch = value.trim().replace(/^refs\/heads\//u, "");
  if (!branch) return undefined;
  if (branch.length > 255) throw new WorkTasksClientError("Task project branch exceeds 255 characters");
  if (branch.startsWith("-")
    || /[\s\u0000-\u001f\u007f]/u.test(branch)
    || /\.\.|@\{|[~^:?*\[\\]/u.test(branch)
    || branch.endsWith(".")
    || branch.endsWith("/")
    || branch.includes("//")) {
    throw new WorkTasksClientError("Task project branch must be a safe Git branch name");
  }
  return branch;
}

export class WorkTasksClient {
  constructor({ baseUrl, clientId = "orca-graph-engineering", allowInsecureLoopback = false, fetchImpl = fetch, timeoutMs = 20_000 }) {
    this.baseUrl = validateWorkTasksBaseUrl(baseUrl, { allowInsecureLoopback });
    this.apiBase = `${this.baseUrl}${workspaceApiPath()}`;
    this.clientId = String(clientId || "orca-graph-engineering").trim() || "orca-graph-engineering";
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.session = null;
  }

  async bootstrap() {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/`, { redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new WorkTasksClientError("cannot reach the workspace over the configured base URL", { cause: error });
    }
    if (!response.ok) throw await this.responseError(response);
    const body = await response.text();
    const pattern = sessionTokenPattern();
    if (!pattern) return null;
    const match = pattern.exec(body);
    if (!match?.groups?.value) throw new WorkTasksClientError("the workspace did not expose the configured short-lived session bootstrap");
    this.session = match.groups.value;
    return this.session;
  }

  async responseError(response) {
    let detail = { detail: "non-JSON error response" };
    try { detail = sanitize(await response.json()); } catch { /* safe generic detail */ }
    return new WorkTasksClientError(`Work Tasks API returned HTTP ${response.status}: ${JSON.stringify(detail)}`, {
      status: response.status,
      detail,
    });
  }

  async request(method, path, payload, options = {}) {
    if (!String(path).startsWith("/") || String(path).startsWith("//")) throw new WorkTasksClientError("API path must be a single absolute path");
    const timeoutMs = Number(options.timeoutMs ?? this.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000) {
      throw new WorkTasksClientError("Work Tasks request timeout must be between 1 and 900 seconds");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.session || attempt === 1) await this.bootstrap();
      let response;
      try {
        response = await this.fetchImpl(`${this.apiBase}${path}`, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            [workspaceSessionHeader()]: this.session,
            [workspaceClientHeader()]: this.clientId,
            ...(payload !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        });
      } catch (error) {
        throw new WorkTasksClientError("workspace API request failed", { cause: error });
      }
      if (response.status === 401 && attempt === 0) { this.session = null; continue; }
      if (!response.ok) throw await this.responseError(response);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new WorkTasksClientError("Work Tasks response exceeded 5 MiB");
      let result;
      try { result = JSON.parse(Buffer.from(bytes).toString("utf8")); }
      catch { throw new WorkTasksClientError("Work Tasks API returned invalid JSON"); }
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new WorkTasksClientError("Work Tasks API returned an unexpected JSON shape");
      return result;
    }
    throw new WorkTasksClientError("Work Tasks authentication failed");
  }

  get(path, options) { return this.request("GET", path, undefined, options); }
  post(path, payload, options) { return this.request("POST", path, payload, options); }
  patch(path, payload, options) { return this.request("PATCH", path, payload, options); }
  put(path, payload, options) { return this.request("PUT", path, payload, options); }
}

export function workTasksClientFromEnvironment(environment = process.env) {
  const baseUrl = environment.ORCA_GRAPH_WORKSPACE_BASE_URL;
  if (!baseUrl) return null;
  return new WorkTasksClient({
    baseUrl,
    clientId: environment.ORCA_GRAPH_WORKSPACE_CLIENT_ID || "orca-graph-engineering",
    allowInsecureLoopback: environment.ORCA_GRAPH_WORKSPACE_ALLOW_INSECURE_LOOPBACK === "1",
  });
}

export function workTasksClientFromDataSource(config) {
  if (config?.mode !== "structured" || typeof config.url !== "string") return null;
  let endpoint;
  try { endpoint = new URL(config.url); } catch { return null; }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname.replace(/\/+$/u, "") !== workspaceApiPath()) return null;
  const allowInsecureLoopback = endpoint.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  try {
    return new WorkTasksClient({
      baseUrl: endpoint.origin,
      clientId: "orca-graph-engineering-data-source",
      allowInsecureLoopback,
    });
  } catch {
    return null;
  }
}

export function taskProjectInput(project) {
  const locatorKind = project.locator_kind ?? project.locatorKind;
  const branch = normalizeWorkBranch(project.branch);
  return {
    ...(project.id ? { id: project.id } : {}),
    role: project.role,
    locator_kind: locatorKind,
    locator: project.locator,
    ...(project.label ? { label: project.label } : {}),
    ...(branch ? { branch } : {}),
    position: Number(project.position) || 0,
  };
}

export function todoQuickTaskInput(todo) {
  const content = typeof todo?.content === "string" ? todo.content : "";
  if (!content.trim()) throw new WorkTasksClientError(`todo has no content: ${todo?.id || "unknown"}`);
  return {
    title: content.trim().slice(0, 300) || String(todo.id),
    description: typeof todo.memo === "string" && todo.memo.trim() ? todo.memo : null,
    due_on: todo.due_on ?? null,
    priority: todo.priority,
    // The Todo source text is the Task draft contract. Do not trim or normalize it.
    draft: content,
  };
}
