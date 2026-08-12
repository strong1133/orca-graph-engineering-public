import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { atomicJson, defaultTargetsPath, readJson, root, targetsPath } from "./paths.mjs";

const execFileAsync = promisify(execFile);

const orcaCommand = process.env.ORCA_CLI_COMMAND ||
  (process.env.ORCA_DEV_REPO_ROOT ? "orca-dev" : process.platform === "linux" ? "orca-ide" : "orca");

async function resolveOrcaInvocation() {
  if (process.env.ORCA_CLI_COMMAND || process.env.ORCA_DEV_REPO_ROOT || process.platform !== "darwin") {
    return { command: orcaCommand, prefix: [] };
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/which", [orcaCommand], { timeout: 5_000 });
    const launcher = await realpath(String(stdout).trim());
    const entrypoint = path.resolve(path.dirname(launcher), "..", "app.asar.unpacked", "out", "cli", "index.js");
    await access(entrypoint);
    // macOS 런처는 ELECTRON_RUN_AS_NODE로 Electron을 다시 태운다. 같은 공개 CLI
    // 계약인 JS 진입점을 직접 부르면 그 왕복 없이 이 Node 프로세스에서 바로 돈다.
    return { command: process.execPath, prefix: [entrypoint] };
  } catch {
    return { command: orcaCommand, prefix: [] };
  }
}

const orcaInvocation = await resolveOrcaInvocation();

export async function runOrca(args, { timeout = 30_000, cwd = root, environment = null } = {}) {
  const scopedArgs = environment ? [...args, "--environment", environment] : args;
  // 이 CLI는 Orca 터미널 안에서 실행된다. 그 pane의 암묵적 selector를 자식에게
  // 물려주면 Orca가 명령을 그 pane으로 되돌려 보내 간헐적으로 실패한다.
  const childEnv = { ...process.env };
  for (const key of [
    "ORCA_PANE_KEY", "ORCA_TAB_ID", "ORCA_TERMINAL_HANDLE",
    "ORCA_WORKSPACE_ID", "ORCA_WORKTREE_ID", "ORCA_SHELL_READY_MARKER",
  ]) delete childEnv[key];
  let stdout;
  try {
    ({ stdout } = await execFileAsync(orcaInvocation.command, [...orcaInvocation.prefix, ...scopedArgs, "--json"], {
      cwd, env: childEnv, timeout, maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (error) {
    const details = [error?.stderr, error?.stdout]
      .map((value) => String(value || "").trim()).filter(Boolean).join("\n").slice(0, 4_000);
    throw new Error([
      error instanceof Error ? error.message.trim() : String(error),
      details,
    ].filter(Boolean).join("\n"), { cause: error });
  }
  const payload = JSON.parse(stdout);
  if (!payload.ok) {
    throw new Error(payload.error?.message || payload.error?.code || `${orcaCommand} ${args.join(" ")} failed`);
  }
  return payload.result;
}

export async function readTargets() {
  const [current, defaults] = await Promise.all([
    readJson(targetsPath, defaultTargetsPath),
    readJson(defaultTargetsPath, defaultTargetsPath),
  ]);
  const defaultsById = new Map((defaults.models ?? []).map((model) => [model.id, model]));
  return {
    ...current,
    models: (current.models ?? defaults.models ?? []).map((model) => {
      const baseline = defaultsById.get(model.id);
      return { ...baseline, ...model, reasoningLevels: model.reasoningLevels ?? baseline?.reasoningLevels ?? [] };
    }),
  };
}

async function environmentTargets(environment) {
  const [projectResult, worktreeResult] = await Promise.all([
    runOrca(["project", "list"], { environment: environment.selector }),
    runOrca(["worktree", "ps", "--limit", "300"], { environment: environment.selector }),
  ]);
  const rawProjects = Array.isArray(projectResult.projects) ? projectResult.projects : [];
  const worktrees = Array.isArray(worktreeResult.worktrees) ? worktreeResult.worktrees : [];
  const activeWorktree = worktrees.find((worktree) => worktree.isActive && !worktree.isArchived);
  const worktreeByRepo = new Map();
  for (const worktree of worktrees) {
    const current = worktreeByRepo.get(worktree.repoId);
    if (!current || worktree.isActive || worktree.isMainWorktree) worktreeByRepo.set(worktree.repoId, worktree);
  }
  const projects = rawProjects.map((project) => {
    const repoId = project.sourceRepoIds?.[0];
    const worktree = repoId ? worktreeByRepo.get(repoId) : undefined;
    return {
      id: project.id,
      name: project.displayName,
      environmentId: environment.id,
      ...(repoId ? { repoId } : {}),
      ...(worktree?.worktreeId ? { worktreeId: worktree.worktreeId } : {}),
      ...(worktree?.path ? { path: worktree.path } : {}),
      ...(worktree?.branch ? { branch: worktree.branch } : {}),
      ...(activeWorktree?.worktreeId && worktree?.worktreeId === activeWorktree.worktreeId ? { current: true } : {}),
    };
  });
  const projectByRepo = new Map();
  for (const project of projects) if (project.repoId) projectByRepo.set(project.repoId, project.id);
  const agentsByWorktree = new Map(worktrees.map((worktree) => [
    worktree.worktreeId,
    new Map((worktree.agents ?? []).filter((agent) => agent?.paneKey).map((agent) => [agent.paneKey, agent])),
  ]));
  const branches = worktrees.flatMap((worktree) => {
    const projectId = projectByRepo.get(worktree.repoId);
    if (!projectId || !worktree.worktreeId || !worktree.branch || worktree.isArchived) return [];
    return [{
      id: `${environment.id}:${worktree.worktreeId}`,
      branch: String(worktree.branch),
      environmentId: environment.id,
      projectId,
      repoId: String(worktree.repoId),
      worktreeId: String(worktree.worktreeId),
      ...(worktree.path ? { path: String(worktree.path) } : {}),
      // Orca 사이드바가 워크트리를 보여 줄 때 쓰는 값들. 패널이 같은 그룹·같은
      // 순서로 그리려면 이 정보가 대상 목록에 함께 있어야 한다.
      ...(worktree.displayName ? { displayName: String(worktree.displayName) } : {}),
      ...(worktree.isMainWorktree ? { main: true } : {}),
      ...(worktree.isActive ? { active: true } : {}),
      ...(worktree.isPinned ? { pinned: true } : {}),
      ...(Number(worktree.liveTerminalCount) > 0 ? { liveTerminals: Number(worktree.liveTerminalCount) } : {}),
      ...(Number.isFinite(Number(worktree.sortOrder)) ? { sortOrder: Number(worktree.sortOrder) } : {}),
    }];
  });

  const liveWorktrees = worktrees.filter((worktree) => Number(worktree.liveTerminalCount ?? 0) > 0);
  const sessionResults = await Promise.allSettled(liveWorktrees.map((worktree) =>
    runOrca(["terminal", "list", "--worktree", `id:${worktree.worktreeId}`, "--limit", "300"], { environment: environment.selector }),
  ));
  const sessions = [];
  for (const result of sessionResults) {
    if (result.status !== "fulfilled") continue;
    for (const terminal of result.value.terminals ?? []) {
      const paneKey = terminal.tabId && terminal.leafId ? `${terminal.tabId}:${terminal.leafId}` : null;
      const agent = paneKey ? agentsByWorktree.get(terminal.worktreeId)?.get(paneKey) : null;
      const terminalWorktree = worktrees.find((worktree) => worktree.worktreeId === terminal.worktreeId);
      if (!paneKey || !agent?.agentType) continue;
      // 마지막 화면 한 줄은 관측한 사실이다. 실행 현황이 진행을 추정하지 않고도
      // "이 세션이 지금 무엇을 보여 주고 있는지"를 그대로 옮길 수 있다.
      const previewLine = String(terminal.preview || "").split("\n").map((line) => line.trim())
        .filter(Boolean).at(-1) ?? "";
      sessions.push({
        id: terminal.handle,
        title: terminal.title || terminal.preview?.split("\n")[0] || terminal.handle,
        ...(previewLine ? { preview: previewLine.slice(0, 200) } : {}),
        ...(Number.isFinite(Number(terminal.lastOutputAt))
          ? { lastOutputAt: new Date(Number(terminal.lastOutputAt)).toISOString() } : {}),
        environmentId: environment.id,
        worktreeId: terminal.worktreeId,
        ...(projectByRepo.get(String(terminal.worktreeId).split("::")[0])
          ? { projectId: projectByRepo.get(String(terminal.worktreeId).split("::")[0]) }
          : {}),
        ...(terminalWorktree?.branch ? { branch: terminalWorktree.branch } : {}),
        paneKey,
        agentType: agent.agentType,
        agentState: agent.state || "unknown",
        writable: Boolean(terminal.writable),
        connected: Boolean(terminal.connected),
      });
    }
  }
  return { projects, branches, sessions };
}

/**
 * 패널이 실행 대상을 고르려면 프로젝트·worktree branch·살아 있는 agent session
 * 목록이 필요하다. 이 조회만 Orca CLI를 쓰고, 실행 자체는 패널이 세션에 직접
 * 프롬프트를 보내 수행한다.
 */
export async function refreshTargets() {
  const baseTargets = await readTargets();
  let savedEnvironments = [];
  try {
    const result = await runOrca(["environment", "list"]);
    savedEnvironments = Array.isArray(result.environments) ? result.environments : [];
  } catch {
    // 구버전 Orca는 local target만 계속 제공한다.
  }
  const definitions = [
    {
      id: "local",
      name: process.env.ORCA_GRAPH_LOCAL_ENVIRONMENT_NAME || os.hostname().split(".")[0] || "local",
      local: true,
      selector: null,
    },
    ...savedEnvironments.map((environment) => ({
      id: String(environment.id),
      name: String(environment.name || environment.id),
      local: false,
      selector: String(environment.id),
    })),
  ];
  const discovered = await Promise.all(definitions.map(async (environment) => {
    try {
      const value = await environmentTargets(environment);
      return { environment: { id: environment.id, name: environment.name, local: environment.local, connected: true }, ...value };
    } catch (error) {
      if (environment.local) throw error;
      return {
        environment: {
          id: environment.id, name: environment.name, local: false, connected: false,
          error: error instanceof Error ? error.message : String(error),
        },
        projects: [], branches: [], sessions: [],
      };
    }
  }));
  const targets = {
    refreshedAt: new Date().toISOString(),
    environments: discovered.map((item) => item.environment),
    projects: discovered.flatMap((item) => item.projects),
    branches: discovered.flatMap((item) => item.branches ?? []),
    sessions: discovered.flatMap((item) => item.sessions),
    models: baseTargets.models ?? [],
  };
  await atomicJson(targetsPath, targets);
  return targets;
}

/** 이 플러그인이 자기 명령만 받으려고 여는 터미널의 탭 이름. */
export const SAVE_TERMINAL_TITLE = "Graph Engineering";

/**
 * 지금 Orca에서 활성인 워크트리의 selector.
 *
 * `--worktree active`는 현재 디렉터리가 어느 워크트리에 속하는지로 푼다. 이 CLI는
 * 플러그인이 설치된 경로에서 도는데 그 경로는 보통 Orca 워크트리 밖이라, 활성
 * 워크트리를 id로 직접 찾아야 한다. 패널이 글을 넣을 수 있는 터미널도 활성
 * 워크트리 안에 있는 것뿐이므로 기준은 어차피 이것이다.
 */
async function activeWorktreeSelector() {
  const result = await runOrca(["worktree", "ps", "--limit", "300"]);
  const active = (result.worktrees ?? []).find((worktree) => worktree.isActive && !worktree.isArchived);
  return active?.worktreeId ? `id:${active.worktreeId}` : null;
}

/**
 * 저장·실행 명령을 받을 전용 터미널을 확보한다.
 *
 * 패널은 터미널을 만들 수 없다 — 호스트가 패널에 주는 것은 `terminal.sendText`
 * 하나뿐이다. 그래서 CLI가 도는 김에 이 워크트리의 전용 터미널을 확인하고,
 * 없으면 만들어 둔다. 이렇게 해 두면 사용자가 어느 터미널로 보낼지 고를 일이
 * 없고, 사람이 쓰던 셸이나 에이전트 pane에 명령이 섞여 들어가지도 않는다.
 *
 * 닫혀 있으면 다음 실행에서 다시 만든다. 만들지 못해도 저장을 막지 않는다.
 */
export async function ensureSaveTerminal(worktreeSelector = null) {
  try {
    const worktree = worktreeSelector ?? await activeWorktreeSelector();
    if (!worktree) return null;
    const listed = await runOrca(["terminal", "list", "--worktree", worktree, "--limit", "100"]);
    const existing = (listed.terminals ?? []).find((terminal) =>
      terminal.title === SAVE_TERMINAL_TITLE && terminal.connected && terminal.writable);
    if (existing?.handle) return String(existing.handle);
    const created = await runOrca([
      "terminal", "create", "--worktree", worktree, "--title", SAVE_TERMINAL_TITLE,
    ], { timeout: 60_000 });
    const handle = created?.terminal?.handle ?? created?.handle;
    return handle ? String(handle) : null;
  } catch {
    return null;
  }
}

/**
 * 이 장치에서 Orca 대상을 한 번은 읽어 둔다.
 *
 * 대상 목록은 패널을 열 때 bootstrap으로 박히고, 파일이 없으면 패키지에 담긴
 * 기본값(프로젝트 0개·세션 0개)이 실린다. 그 상태의 패널은 실행할 프로젝트도
 * 워크트리도 세션도 고를 수 없다 — 새로 설치한 장치가 정확히 그 상태다.
 *
 * 이미 읽어 둔 파일이 있으면 CLI를 부르지 않는다. 갱신에 실패하면 저장까지
 * 막지 않고 null을 돌려준다. 부르는 쪽이 그 사실을 보고한다.
 */
export async function ensureTargets() {
  try {
    const current = JSON.parse(await readFile(targetsPath, "utf8"));
    if (current?.refreshedAt) return current;
  } catch {
    // 파일이 없거나 깨졌다. 아래에서 새로 읽는다.
  }
  try {
    return await refreshTargets();
  } catch {
    return null;
  }
}
