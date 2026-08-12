export type DispatchModelDefinition = { id: string; agent: string };

export type DispatchTargetInput = {
  label?: string;
  environmentId?: string;
  projectId?: string;
  projectName?: string;
  locator?: string;
  branch?: string;
  worktreeId?: string;
  sessionId?: string;
  sessionTitle?: string;
  model?: string;
  reasoning?: string;
  modelDefinition?: DispatchModelDefinition;
  /** 승인 프롬프트 없이 세션을 띄울지. 지정하지 않으면 우회한다. */
  autoApprove?: boolean;
  /** 이 대상에만 보낼 프롬프트. 없으면 요청의 공통 프롬프트를 쓴다. */
  prompt?: string;
  readyConfirmed?: boolean;
  title?: string;
};

export type DispatchTargetRecord = DispatchTargetInput & {
  label: string;
  sessionId: string;
  opened: "existing-session" | "new-session";
};

export type DispatchRecord = {
  id: string;
  itemKind: string;
  itemId: string;
  title: string;
  dispatchedAt: string;
  executionMode: "single_session" | "per_project";
  targets: DispatchTargetRecord[];
  error?: string;
};

export function commandForModel(model: DispatchModelDefinition, reasoning?: string, autoApprove?: boolean): string;

export function dispatchTarget(target: DispatchTargetInput, prompt: string): Promise<DispatchTargetRecord>;

export function dispatchWorkItem(request: {
  itemKind: string;
  itemId: string;
  title: string;
  prompt: string;
  executionMode?: string;
  targets: DispatchTargetInput[];
}): Promise<DispatchRecord>;
