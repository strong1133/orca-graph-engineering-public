export class WorkTasksClientError extends Error {
  status?: number;
  detail?: unknown;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class WorkTasksClient {
  constructor(options: {
    baseUrl: string;
    clientId?: string;
    allowInsecureLoopback?: boolean;
    fetchImpl?: FetchImplementation;
    timeoutMs?: number;
  });
  get(path: string): Promise<Record<string, unknown>>;
  post(path: string, payload?: unknown): Promise<Record<string, unknown>>;
  patch(path: string, payload?: unknown): Promise<Record<string, unknown>>;
  put(path: string, payload?: unknown): Promise<Record<string, unknown>>;
}

export function validateWorkTasksBaseUrl(
  value: string,
  options?: { allowInsecureLoopback?: boolean },
): string;
export function workTasksEnvironment(value?: string, localName?: string): string | null;
export function mapOrcaRepos(value: unknown, worktreeValue?: unknown): Array<Record<string, unknown>>;
export function normalizeWorkBranch(value?: unknown): string | undefined;
export function taskProjectInput(project: Record<string, unknown>): Record<string, unknown>;
export function workTasksClientFromEnvironment(
  environment?: Record<string, string | undefined>,
): WorkTasksClient | null;
