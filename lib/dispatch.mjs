/*
 * 작업을 Orca 세션으로 내보낸다.
 *
 * 여기서 하는 일은 대상 프로젝트에 claude/codex 세션을 띄우고 프롬프트를 넣는
 * 것까지다. 그 뒤 그래프를 어떤 순서로 도는지, 노드를 언제 claim/complete하는지는
 * 세션의 에이전트가 소유한다. 이 플러그인은 실행기를 따로 두지 않는다.
 *
 * 패널이 직접 하지 못하는 이유는 Orca의 `terminal.sendText`가 활성 워크트리 밖의
 * 터미널을 거부하기 때문이다(main/index.js: "terminal is outside the active
 * worktree"). 다른 프로젝트로 보내려면 공개 `orca` CLI를 거쳐야 한다.
 */
import { runOrca } from "./orca.mjs";

const AGENT_READY_TIMEOUT_SECONDS = 120;

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

/** 모델 정의에서 세션을 띄우는 명령을 만든다. */
export function commandForModel(model, reasoning) {
  if (!model?.id) throw new Error("실행할 모델을 지정해야 새 세션을 만들 수 있습니다.");
  if (model.agent === "claude") {
    return `claude --model ${shellQuote(model.id)}${reasoning ? ` --effort ${shellQuote(reasoning)}` : ""}`;
  }
  if (model.agent === "codex") {
    return `codex --model ${shellQuote(model.id)}${reasoning ? ` -c model_reasoning_effort=${shellQuote(reasoning)}` : ""}`;
  }
  throw new Error(`지원하지 않는 agent입니다: ${model.agent}`);
}

function terminalHandle(result) {
  return result?.terminal?.handle ?? result?.handle ?? null;
}

/**
 * 대상 하나에 프롬프트를 넣는다.
 *
 * 기존 세션이 지정되어 있으면 그 세션에, 없으면 대상 worktree에 새 세션을 띄운다.
 * 새 세션은 에이전트 TUI가 입력을 받을 준비가 될 때까지 기다린 뒤에 보낸다 —
 * 준비 전에 보내면 프롬프트가 그대로 사라진다.
 */
export async function dispatchTarget(target, prompt) {
  const environment = target.environmentId && target.environmentId !== "local" ? target.environmentId : null;

  if (target.sessionId) {
    const shown = await runOrca(["terminal", "show", "--terminal", target.sessionId], { environment });
    if (!shown?.terminal?.connected || !shown.terminal.writable) {
      throw new Error(`세션 ${target.sessionTitle || target.sessionId}에 입력할 수 없습니다. 세션이 닫혔거나 읽기 전용입니다.`);
    }
    await runOrca(["terminal", "send", "--terminal", target.sessionId, "--text", prompt, "--enter"], { environment });
    return {
      label: target.label ?? "",
      ...(target.environmentId ? { environmentId: target.environmentId } : {}),
      ...(target.projectId ? { projectId: target.projectId } : {}),
      ...(target.projectName ? { projectName: target.projectName } : {}),
      ...(target.locator ? { locator: target.locator } : {}),
      ...(target.branch ? { branch: target.branch } : {}),
      sessionId: target.sessionId,
      ...(shown.terminal.title ? { sessionTitle: shown.terminal.title } : {}),
      ...(target.model ? { model: target.model } : {}),
      opened: "existing-session",
    };
  }

  if (!target.worktreeId) {
    throw new Error(`${target.label || "대상"}에 사용할 Orca 워크트리를 찾지 못했습니다. Orca 대상을 갱신한 뒤 다시 시도하십시오.`);
  }
  const created = await runOrca([
    "terminal", "create",
    "--worktree", `id:${target.worktreeId}`,
    "--title", target.title || "Graph Engineering",
    "--command", commandForModel(target.modelDefinition, target.reasoning),
  ], { timeout: 60_000, environment });
  const handle = terminalHandle(created);
  if (!handle) throw new Error(`${target.label || "대상"}에 새 세션을 만들지 못했습니다.`);

  // TUI가 뜨기 전에 보낸 입력은 삼켜진다. idle을 확인한 뒤에 보낸다.
  await runOrca([
    "terminal", "wait", "--terminal", handle,
    "--for", "tui-idle", "--timeout", String(AGENT_READY_TIMEOUT_SECONDS),
  ], { timeout: (AGENT_READY_TIMEOUT_SECONDS + 10) * 1000, environment });
  await runOrca(["terminal", "send", "--terminal", handle, "--text", prompt, "--enter"], { environment });

  return {
    label: target.label ?? "",
    ...(target.environmentId ? { environmentId: target.environmentId } : {}),
    ...(target.projectId ? { projectId: target.projectId } : {}),
    ...(target.projectName ? { projectName: target.projectName } : {}),
    ...(target.locator ? { locator: target.locator } : {}),
    ...(target.branch ? { branch: target.branch } : {}),
    sessionId: handle,
    ...(target.title ? { sessionTitle: target.title } : {}),
    ...(target.model ? { model: target.model } : {}),
    opened: "new-session",
  };
}

/**
 * 대상 전부에 보내고 그 결과를 기록으로 돌려준다.
 *
 * 한 대상이 실패해도 나머지는 계속 보낸다. 부분 성공을 전체 실패로 접으면 이미
 * 작업을 받은 세션이 있다는 사실이 기록에서 사라진다.
 */
export async function dispatchWorkItem({ itemKind, itemId, title, prompt, executionMode, targets }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("보낼 프롬프트가 비어 있습니다.");
  if (!Array.isArray(targets) || !targets.length) throw new Error("보낼 대상이 없습니다.");

  const settled = [];
  const failures = [];
  for (const target of targets) {
    try {
      settled.push(await dispatchTarget(target, prompt));
    } catch (error) {
      failures.push(`${target.label || target.projectName || "대상"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    id: `dispatch-${itemKind}-${itemId}-${Date.now().toString(36)}`,
    itemKind,
    itemId,
    title,
    dispatchedAt: new Date().toISOString(),
    executionMode: executionMode === "per_project" ? "per_project" : "single_session",
    targets: settled,
    ...(failures.length ? { error: failures.join(" / ") } : {}),
  };
}
