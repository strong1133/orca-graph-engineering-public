import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
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
      sessions.push({
        id: terminal.handle,
        title: terminal.title || terminal.preview?.split("\n")[0] || terminal.handle,
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
