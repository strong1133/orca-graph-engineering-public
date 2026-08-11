export const EXECUTION_ENGINEERING_KEYS: string[];

export type RemoteNodeAction = "skip" | "gate" | "condition" | "task" | "fail";

export function remoteNodeDecision(input: {
  runnable?: { id?: string; kind?: string; label?: string } | null;
  design?: { id?: string; kind?: string; label?: string; engineering?: Record<string, unknown> } | null;
  closable?: boolean;
}): { action: RemoteNodeAction; reason: string };

export function nodeAttemptBudget(design?: { engineering?: { maxAttempts?: unknown } } | null): number;

export function runWallDeadline(
  runGuards: { maxWallSeconds?: unknown } | null | undefined,
  runStartedAt: string | undefined,
  now: number,
): number | null;

export function dispatchedResultFailure(summary: unknown): string;

export function droppedNodeEngineering(
  submitted: { nodes?: Array<{ id?: string; label?: string; engineering?: Record<string, unknown> }> } | null | undefined,
  canonical: { nodes?: Array<{ id?: string; engineering?: Record<string, unknown> }> } | null | undefined,
): string[];
