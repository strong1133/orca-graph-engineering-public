export const EXECUTION_ENGINEERING_KEYS: string[];

export function droppedNodeEngineering(
  submitted: { nodes?: Array<{ id?: string; label?: string; engineering?: Record<string, unknown> }> } | null | undefined,
  canonical: { nodes?: Array<{ id?: string; engineering?: Record<string, unknown> }> } | null | undefined,
): string[];
