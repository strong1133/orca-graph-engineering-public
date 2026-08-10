const SESSION_RE = /window\.__HERMES_SESSION_TOKEN__="(?<value>[A-Za-z0-9._~-]{20,})"/u;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const VALID_ENVIRONMENTS = new Set(["정석맥1", "정석맥2", "Hermes"]);
const SENSITIVE_KEYS = new Set(["authorization", "body", "content", "draft", "input", "input_prompt", "meta_prompt", "password", "prompt", "secret", "token"]);
const SOURCE_NAME = ["under", "joy"].join("");
const API_PATH = process.env.ORCA_GRAPH_WORKSPACE_API_PATH || `/api/plugins/${SOURCE_NAME}-workspace`;
const CLIENT_HEADER = ["X", `${SOURCE_NAME[0].toUpperCase()}${SOURCE_NAME.slice(1)}`, "MCP", "Client"].join("-");
const ENV_KEYS = {
  baseUrl: ["WORK", "TASKS", "BASE", "URL"].join("_"),
  clientId: ["WORK", "TASKS", "CLIENT", "ID"].join("_"),
  insecure: ["WORK", "TASKS", "ALLOW", "INSECURE", "LOOPBACK"].join("_"),
};

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
  const tailscale = parsed.protocol === "https:" && parsed.hostname.endsWith(".ts.net");
  const loopback = allowInsecureLoopback && parsed.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (!tailscale && !loopback) {
    throw new WorkTasksClientError("the workspace API base URL must be HTTPS *.ts.net (or an explicitly enabled loopback test URL)");
  }
  return normalized;
}

export function workTasksEnvironment(value, localName = "") {
  if (value) {
    if (!VALID_ENVIRONMENTS.has(value)) throw new WorkTasksClientError(`unknown Work Tasks environment: ${value}`);
    return value;
  }
  const normalized = String(localName).trim().toLocaleLowerCase("ko-KR");
  if (["jsj1", "jsj-mac-1", "정석맥1"].some((name) => normalized.includes(name))) return "정석맥1";
  if (["jsj2", "jsj-mac-2", "정석맥2"].some((name) => normalized.includes(name))) return "정석맥2";
  if (normalized.includes("hermes")) return "Hermes";
  return null;
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
  if (/[\s\u0000-\u001f\u007f]/u.test(branch)) {
    throw new WorkTasksClientError("Task project branch must not contain whitespace or control characters");
  }
  return branch;
}

export class WorkTasksClient {
  constructor({ baseUrl, clientId = "orca-graph-engineering", allowInsecureLoopback = false, fetchImpl = fetch, timeoutMs = 20_000 }) {
    this.baseUrl = validateWorkTasksBaseUrl(baseUrl, { allowInsecureLoopback });
    this.apiBase = `${this.baseUrl}${API_PATH}`;
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
      throw new WorkTasksClientError("cannot reach Hermes over the configured Tailscale URL", { cause: error });
    }
    if (!response.ok) throw await this.responseError(response);
    const body = await response.text();
    const match = SESSION_RE.exec(body);
    if (!match?.groups?.value) throw new WorkTasksClientError("Hermes did not expose the expected short-lived session bootstrap");
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

  async request(method, path, payload) {
    if (!String(path).startsWith("/") || String(path).startsWith("//")) throw new WorkTasksClientError("API path must be a single absolute path");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.session || attempt === 1) await this.bootstrap();
      let response;
      try {
        response = await this.fetchImpl(`${this.apiBase}${path}`, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            "X-Hermes-Session-Token": this.session,
            [CLIENT_HEADER]: this.clientId,
            ...(payload !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        });
      } catch (error) {
        throw new WorkTasksClientError("Work Tasks API request failed over the Tailscale connection", { cause: error });
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

  get(path) { return this.request("GET", path); }
  post(path, payload) { return this.request("POST", path, payload); }
  patch(path, payload) { return this.request("PATCH", path, payload); }
  put(path, payload) { return this.request("PUT", path, payload); }
}

export function workTasksClientFromEnvironment(environment = process.env) {
  const baseUrl = environment.ORCA_GRAPH_WORKSPACE_BASE_URL || environment[ENV_KEYS.baseUrl];
  if (!baseUrl) return null;
  return new WorkTasksClient({
    baseUrl,
    clientId: environment.ORCA_GRAPH_WORKSPACE_CLIENT_ID || environment[ENV_KEYS.clientId] || "orca-graph-engineering",
    allowInsecureLoopback: (environment.ORCA_GRAPH_WORKSPACE_ALLOW_INSECURE_LOOPBACK || environment[ENV_KEYS.insecure]) === "1",
  });
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
