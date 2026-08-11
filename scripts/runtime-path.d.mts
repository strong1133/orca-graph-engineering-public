export function resolveRuntimeDirectory(): string;
export function prepareRuntimeDirectory(
  root: string,
  runtimeDirectory: string,
  options?: { migrate?: boolean },
): Promise<void>;
