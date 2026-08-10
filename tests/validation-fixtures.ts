import { readFileSync } from "node:fs";
import path from "node:path";
import type { GraphDefinition, GraphEdge, GraphNode } from "../src/model";

type FixtureNode = Partial<GraphNode> & Pick<GraphNode, "id">;

export interface ValidationFixtureCase {
  id: string;
  bridgeMode: "dry" | "live";
  expected: {
    code: string | null;
    severity: "error" | null;
  };
  loopGuards?: boolean;
  nodes: FixtureNode[];
  edges: GraphEdge[];
}

const matrix = JSON.parse(readFileSync(
  path.join(process.cwd(), "fixtures/graph-validation-matrix.json"),
  "utf8",
)) as { schemaVersion: number; cases: ValidationFixtureCase[] };

if (matrix.schemaVersion !== 1) throw new Error("unsupported graph validation fixture matrix");

export const validationFixtureCases = matrix.cases;

export function graphFromValidationFixture(item: ValidationFixtureCase): GraphDefinition {
  const now = "2026-08-09T00:00:00.000Z";
  return {
    id: `fixture-${item.id}`,
    name: item.id,
    summary: "shared model/bridge validation fixture",
    status: "active",
    version: 1,
    pinned: false,
    processEnabled: false,
    routineEnabled: false,
    repeatMode: item.loopGuards ? "loop" : "none",
    ...(item.loopGuards ? { maxRuns: 3 } : {}),
    defaults: { sessionId: "fake-session", model: "gpt-5.6-sol" },
    runGuards: item.loopGuards
      ? { maxWallSeconds: 30, stagnationRuns: 2, maxBudgetTokens: 10_000 }
      : {},
    engineering: { humanGateForIrreversible: true, checkpointPolicy: "node" },
    nodes: item.nodes.map((node, index) => {
      const { id, ...overrides } = structuredClone(node);
      const normalized: GraphNode = {
        id,
        kind: "task",
        label: id,
        x: index * 240,
        y: 0,
        status: "pending",
        joinMode: "all",
        task: { id: `task-${id}`, title: id, prompt: `execute ${id}` },
        ...overrides,
      };
      if (normalized.kind === "condition") {
        delete normalized.task;
        normalized.conditionExpr ??= `choose a branch for ${id}`;
      }
      return normalized;
    }),
    edges: structuredClone(item.edges),
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
}
