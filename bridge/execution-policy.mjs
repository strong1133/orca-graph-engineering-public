/* 실행 판정 중 원천·Orca와 무관한 순수 규칙만 모은다.

   원격 실행기는 HTTP 원천 뒤에 있어 종단 테스트가 어렵다. 그렇다고 판정 자체를
   검증하지 않으면 승인 게이트를 에이전트에게 넘기는 것 같은 조용한 오동작을
   놓친다. 결정은 여기서 순수 함수로 내리고, 실행기는 그 결정을 수행만 한다. */

/** 노드에 실려 있으면 실행 의미가 달라지는 계약 키. */
export const EXECUTION_ENGINEERING_KEYS = [
  "role", "approvalStatus", "maxAttempts", "timeoutSeconds", "permissions", "dataClass",
  "idempotencyKey", "budgetTokens", "irreversible", "sideEffect", "compensation",
  "evidenceRequired", "contextMode", "retention",
];

/**
 * 원격 실행기가 노드 하나를 어떻게 다룰지 결정한다.
 * frontier(원천)와 design(패널 스냅샷) 둘 다 필요하다 — 실행 의미는 design에만 있다.
 */
export function remoteNodeDecision({ runnable, design, closable = false }) {
  if (closable) return { action: "skip", reason: "선택되지 않은 분기라 건너뜁니다." };
  if (!design) {
    return { action: "fail", reason: "node is missing from the panel snapshot; refresh the data source" };
  }
  if (design.engineering?.role === "human_gate") {
    const approval = design.engineering.approvalStatus || "pending";
    // 승인 게이트는 에이전트에게 넘길 작업이 아니다. preflight가 되돌릴 수 없는
    // 작업마다 이 게이트의 지배를 요구하므로 여기서 건너뛰면 계약이 깨진다.
    return approval === "approved"
      ? { action: "gate", reason: "human approval recorded" }
      : { action: "fail", reason: `human approval is ${approval}` };
  }
  if (runnable?.kind === "graph_call" || design.kind === "graph_call") {
    // 자식 그래프는 자체 run 수명주기를 가진다. 그 계약이 없는 동안 에이전트
    // 작업으로 잘못 보내느니 여기서 막는다.
    return {
      action: "fail",
      reason: "graph_call은 원격 실행에서 아직 지원하지 않습니다. 자식 그래프를 직접 실행하거나 로컬 원천에서 실행하십시오.",
    };
  }
  if (runnable?.kind === "condition") return { action: "condition", reason: "" };
  return { action: "task", reason: "" };
}

/** 노드가 소비할 수 있는 시도 횟수. 설정이 없으면 1회다. */
export function nodeAttemptBudget(design) {
  return Math.max(1, Number(design?.engineering?.maxAttempts || 1));
}

/**
 * run 시간 한도의 절대 시각. 한도가 없으면 null이고 실행기는 검사하지 않는다.
 * run 시작 시각을 못 읽으면 관측을 시작한 시점부터 센다 — 한도를 무한으로 풀지 않는다.
 */
export function runWallDeadline(runGuards, runStartedAt, now) {
  const seconds = Number(runGuards?.maxWallSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const started = Date.parse(runStartedAt ?? "");
  return (Number.isFinite(started) ? started : now) + seconds * 1_000;
}

/**
 * 에이전트의 마지막 응답에서 계약된 결과 줄을 읽는다. 실패면 사유를, 그 외에는 빈 문자열.
 * 굵게 쓰거나 목록·인용 기호가 앞에 붙어도 같게 읽는다 — 실패 보고를 놓치면
 * 실패한 노드가 done으로 굳는다.
 */
const DISPATCH_RESULT_SCAN_LINES = 5;

export function dispatchedResultFailure(summary, { required = false } = {}) {
  const lines = String(summary || "").split(/\r?\n/u)
    .map((line) => line.replace(/^[\s>*\-#]+/u, "").replace(/[*`_]/gu, "").trim())
    .filter(Boolean)
    .slice(0, DISPATCH_RESULT_SCAN_LINES);
  for (const line of lines) {
    const match = line.match(/^RESULT:\s*(done|failed)\b\s*(?:[—:-]\s*)?(.*)$/iu);
    if (!match) continue;
    if (match[1].toLowerCase() === "done") return "";
    return match[2]?.trim() || "agent reported failed or blocked work";
  }
  // 계약을 지키지 않은 응답을 성공으로 읽으면 실패가 완료로 굳는다. 기본값은
  // 기존 그래프를 깨지 않도록 관대하게 두고, 엄격 모드에서만 fail-closed한다.
  return required ? "agent did not report the required RESULT line" : "";
}

/** 원천이 저장하지 않은 노드 실행 계약. 계약 v1은 provider가 무시하는 것을 허용한다. */
export function droppedNodeEngineering(submitted, canonical) {
  const canonicalNodes = new Map((canonical?.nodes ?? []).map((node) => [node.id, node]));
  const dropped = [];
  for (const node of submitted?.nodes ?? []) {
    const sent = node.engineering;
    if (!sent || typeof sent !== "object") continue;
    const kept = canonicalNodes.get(node.id)?.engineering ?? {};
    const missing = EXECUTION_ENGINEERING_KEYS.filter((key) => sent[key] !== undefined && kept[key] === undefined);
    if (missing.length) dropped.push(`${node.label || node.id}: ${missing.join(", ")}`);
  }
  return dropped;
}
