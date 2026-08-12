import type { DispatchRecord, GraphStore, PanelView } from "../src/model.js";

export type ResultLine = { status: "done" | "failed"; message?: string };

/** 세션 화면에서 프롬프트가 요구한 결과 줄을 찾는다. 없으면 null. */
export function parseResultLine(tail: string | undefined): ResultLine | null;

export function parseNodeStates(tail: string | undefined): Record<string, { status: "running" | "done" | "failed" | "skipped"; message?: string }>;

export function refreshDispatchOutcomes(): Promise<{ scanned: number; log: DispatchRecord[] }>;

export function recordDispatch(record: DispatchRecord, panelView?: PanelView): Promise<DispatchRecord>;

export function recordSaveTerminal(terminalId: string | null): Promise<string | null>;

export function saveChanges(changes: unknown): Promise<{ mode: string; store?: GraphStore; warnings: string[] }>;

export function refreshSource(config?: unknown, preferredGraphId?: string): Promise<any>;

export function configureSource(config: unknown, seedStore?: unknown): Promise<any>;

export function writePanelSnapshot(): Promise<boolean>;

export function readDataSourceConfig(): Promise<any>;

export function storeBackedSource(mode: string): boolean;

export function dropLegacyRuntimeKeys(store: unknown): Record<string, unknown>;

export function validateChanges(changes: unknown): unknown;

export const DISPATCH_LOG_LIMIT: number;
