import type { OrcaTargets } from "../src/model.js";

/** 이 플러그인이 자기 명령만 받으려고 여는 터미널의 탭 이름. */
export const SAVE_TERMINAL_TITLE: string;

export function runOrca(
  args: string[],
  options?: { timeout?: number; cwd?: string; environment?: string | null },
): Promise<any>;

export function readTargets(): Promise<OrcaTargets>;

export function refreshTargets(): Promise<OrcaTargets>;

/** 이 장치에서 한 번도 읽지 않았을 때만 Orca 대상을 읽는다. 실패하면 null. */
export function ensureTargets(): Promise<OrcaTargets | null>;

/** 이 워크트리의 전용 터미널 handle. 없으면 만들고, 만들지 못하면 null. */
export function ensureSaveTerminal(worktree?: string): Promise<string | null>;
