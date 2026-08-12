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

const AGENT_READY_TIMEOUT_SECONDS = Number(process.env.ORCA_GRAPH_AGENT_READY_TIMEOUT_SECONDS) || 45;
const SUBMIT_QUIET_MS = Number(process.env.ORCA_GRAPH_SUBMIT_QUIET_MS) || 800;
const SUBMIT_QUIET_TIMEOUT_MS = Number(process.env.ORCA_GRAPH_SUBMIT_QUIET_TIMEOUT_MS) || 15_000;
const SUBMIT_POLL_MS = 250;

/** 화면 출력이 멎을 때까지 기다린다. 붙여넣기가 다 흘러들어왔다는 뜻이다. */
async function waitForQuietScreen(handle, environment) {
  let lastStamp = null;
  let stableSince = Date.now();
  const deadline = Date.now() + SUBMIT_QUIET_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const shown = await runOrca(["terminal", "show", "--terminal", handle], { environment }).catch(() => null);
    const stamp = Number(shown?.terminal?.lastOutputAt) || 0;
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= SUBMIT_QUIET_MS) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SUBMIT_POLL_MS));
  }
}

/**
 * 프롬프트를 넣고 제출한다.
 *
 * 텍스트와 Enter를 한 번에 보내면 에이전트 TUI가 그 뭉치를 붙여넣기로 보고, 끝의
 * Enter를 제출이 아니라 줄바꿈으로 넣는다. 프롬프트는 여러 줄이라 항상 그렇게 된다 —
 * 입력창에 글만 남고 아무 일도 일어나지 않는다.
 *
 * 그래서 텍스트를 먼저 보내고, 화면 출력이 멎은 뒤에 Enter만 따로 보낸다. 고정된
 * 시간을 기다리면 안 된다 — UI가 pane을 받아들이지 않은 세션에서는 붙여넣기가 느리게
 * 흘러들어와, 정해 둔 시간이 지나도 아직 끝나지 않는다.
 */
async function submitPrompt(handle, prompt, environment) {
  await runOrca(["terminal", "send", "--terminal", handle, "--text", prompt], { environment });
  await waitForQuietScreen(handle, environment);
  await runOrca(["terminal", "send", "--terminal", handle, "--enter"], { environment });
}

/** 실패했을 때 화면 마지막 줄. 왜 죽었는지는 거기 적혀 있다. */
async function terminalTail(handle, environment) {
  try {
    const read = await runOrca(["terminal", "read", "--terminal", handle], { environment });
    return (read?.terminal?.tail ?? []).map((line) => String(line).trim())
      .filter(Boolean).slice(-3).join(" / ").slice(0, 300);
  } catch {
    return "";
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

/**
 * 모델 정의에서 세션을 띄우는 명령을 만든다.
 *
 * 이 세션은 사람이 지켜보지 않는다. 승인 프롬프트가 뜨면 프롬프트만 받아 둔 채
 * 아무것도 하지 못하고 멈추므로, 기본은 승인을 우회해서 띄운다. 우회를 끄면
 * 그 세션은 첫 명령에서 사람을 기다린다 — 원격에서는 그 대기를 볼 수 없다.
 */
export function commandForModel(model, reasoning, autoApprove = true) {
  if (!model?.id) throw new Error("실행할 모델을 지정해야 새 세션을 만들 수 있습니다.");
  if (model.agent === "claude") {
    return [
      `claude --model ${shellQuote(model.id)}`,
      reasoning ? ` --effort ${shellQuote(reasoning)}` : "",
      autoApprove ? " --permission-mode bypassPermissions" : "",
    ].join("");
  }
  if (model.agent === "codex") {
    return [
      `codex --model ${shellQuote(model.id)}`,
      reasoning ? ` -c model_reasoning_effort=${shellQuote(reasoning)}` : "",
      // `-a`와 함께 쓰면 codex가 "cannot be used with"로 거절하고 즉시 죽는다.
      // 이 플래그 하나가 승인과 샌드박스를 모두 끈다.
      autoApprove ? " --dangerously-bypass-approvals-and-sandbox" : "",
    ].join("");
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
export async function dispatchTarget(target, basePrompt) {
  const environment = target.environmentId && target.environmentId !== "local" ? target.environmentId : null;
  // 프로젝트별 실행은 대상마다 실행 컨텍스트가 다르므로 프롬프트도 대상이 들고 온다.
  const prompt = typeof target.prompt === "string" && target.prompt.trim() ? target.prompt : basePrompt;

  if (target.sessionId) {
    const shown = await runOrca(["terminal", "show", "--terminal", target.sessionId], { environment });
    if (!shown?.terminal?.connected || !shown.terminal.writable) {
      throw new Error(`세션 ${target.sessionTitle || target.sessionId}에 입력할 수 없습니다. 세션이 닫혔거나 읽기 전용입니다.`);
    }
    await submitPrompt(target.sessionId, prompt, environment);
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
  const agentCommand = commandForModel(target.modelDefinition, target.reasoning, target.autoApprove !== false);
  const created = await runOrca([
    "terminal", "create",
    "--worktree", `id:${target.worktreeId}`,
    "--title", target.title || "Graph Engineering",
    // `exec`로 띄우면 에이전트가 죽는 순간 터미널도 함께 죽는다. 셸이 남지 않으므로
    // 프롬프트가 에이전트 대신 셸에 타이핑되는 일이 원천적으로 없다.
    "--command", `exec ${agentCommand}`,
  ], { timeout: 60_000, environment });
  const handle = terminalHandle(created);
  if (!handle) throw new Error(`${target.label || "대상"}에 새 세션을 만들지 못했습니다.`);

  // TUI가 뜨기 전에 보낸 입력은 삼켜진다. idle을 확인한 뒤에 보낸다.
  // 이 대기는 밀리초 단위 `--timeout-ms`를 받는다. 초 단위 `--timeout`으로 부르면
  // CLI가 알 수 없는 플래그로 거절해, 세션만 만들어 두고 프롬프트는 못 넣는다.
  let readyError = "";
  try {
    await runOrca([
      "terminal", "wait", "--terminal", handle,
      "--for", "tui-idle", "--timeout-ms", String(AGENT_READY_TIMEOUT_SECONDS * 1_000),
    ], { timeout: (AGENT_READY_TIMEOUT_SECONDS + 10) * 1000, environment });
  } catch (error) {
    readyError = (error instanceof Error ? error.message : String(error)).split("\n")[0];
  }

  // 보내기 전에 에이전트가 아직 살아 있는지 본다. 플래그 하나만 틀려도 명령은 즉시
  // 죽고, 그때 프롬프트를 보내면 각 줄이 셸 명령으로 실행된다.
  let alive = false;
  try {
    const shown = await runOrca(["terminal", "show", "--terminal", handle], { environment });
    alive = Boolean(shown?.terminal?.connected && shown.terminal.writable);
  } catch {
    alive = false;
  }
  if (!alive) {
    const tail = await terminalTail(handle, environment);
    throw new Error([
      `${target.label || "대상"}에 에이전트가 뜨지 않아 프롬프트를 보내지 않았습니다.`,
      `명령: ${agentCommand}`,
      tail ? `터미널: ${tail}` : "",
    ].filter(Boolean).join(" "));
  }
  // 준비 신호를 못 받았어도 세션이 살아 있으면 보낸다. `tui-idle`은 UI가 pane을
  // 받아들였을 때만 나오는 신호라, 백그라운드 handle로 열린 세션에서는 영영 오지
  // 않는다. 그때 보내지 않으면 멀쩡한 세션이 빈손으로 남는다 — 대신 확인 없이
  // 보냈다는 사실을 기록에 남겨 둔다.
  await submitPrompt(handle, prompt, environment);

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
    ...(readyError ? { readyConfirmed: false } : {}),
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
  const PROMPT_RECORD_LIMIT = 8_000;
  return {
    id: `dispatch-${itemKind}-${itemId}-${Date.now().toString(36)}`,
    itemKind,
    itemId,
    title,
    prompt: prompt.slice(0, PROMPT_RECORD_LIMIT),
    ...(prompt.length > PROMPT_RECORD_LIMIT ? { promptTruncated: true } : {}),
    dispatchedAt: new Date().toISOString(),
    executionMode: executionMode === "per_project" ? "per_project" : "single_session",
    targets: settled,
    ...(failures.length ? { error: failures.join(" / ") } : {}),
  };
}
