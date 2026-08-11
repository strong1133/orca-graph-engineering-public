/* 노드에 실려 있으면 실행 의미가 달라지는 계약 키와, 원천이 그 계약을 삼켰는지
   가리는 순수 비교. 실행 자체는 대상 세션의 에이전트가 수행하므로 여기에는
   판정 로직이 없다 — 저장이 조용히 계약을 잃는 것만 감지한다. */

export const EXECUTION_ENGINEERING_KEYS = [
  "role", "approvalStatus", "maxAttempts", "timeoutSeconds", "permissions", "dataClass",
  "idempotencyKey", "budgetTokens", "irreversible", "sideEffect", "compensation",
  "evidenceRequired", "contextMode", "retention",
];

/**
 * 원천에 커밋한 그래프가 노드 실행 계약을 보존했는지 확인한다.
 * 보존하지 않은 원천에 저장하면 사용자는 승인 게이트나 재시도 한도를 적어 두고도
 * 그것이 사라진 줄 모른다. 저장 응답에 경고로 실어 보낸다.
 */
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
