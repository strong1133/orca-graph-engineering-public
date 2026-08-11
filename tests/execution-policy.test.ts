import { describe, expect, it } from "vitest";
import {
  dispatchedResultFailure,
  droppedNodeEngineering,
  nodeAttemptBudget,
  remoteNodeDecision,
  runWallDeadline,
} from "../bridge/execution-policy.mjs";

const taskNode = { id: "node-1", kind: "task", label: "구현", engineering: {} };

describe("remote node decision", () => {
  it("never hands an unapproved human gate to an agent", () => {
    for (const approval of [undefined, "pending", "rejected"]) {
      const design = { ...taskNode, engineering: { role: "human_gate", ...(approval ? { approvalStatus: approval } : {}) } };
      const decision = remoteNodeDecision({ runnable: { id: "node-1", kind: "task" }, design });
      expect(decision.action).toBe("fail");
      expect(decision.reason).toContain(`human approval is ${approval ?? "pending"}`);
    }
  });

  it("passes an approved human gate without dispatching work", () => {
    const design = { ...taskNode, engineering: { role: "human_gate", approvalStatus: "approved" } };
    expect(remoteNodeDecision({ runnable: { id: "node-1", kind: "task" }, design }).action).toBe("gate");
  });

  it("blocks a graph_call node instead of sending it as a plain agent task", () => {
    // frontier 쪽 kind만 있어도, 설계 쪽 kind만 있어도 같은 판정이어야 한다.
    for (const [runnable, design] of [
      [{ id: "node-1", kind: "graph_call" }, taskNode],
      [{ id: "node-1", kind: "task" }, { ...taskNode, kind: "graph_call" }],
    ] as const) {
      const decision = remoteNodeDecision({ runnable, design });
      expect(decision.action).toBe("fail");
      expect(decision.reason).toContain("graph_call");
    }
  });

  it("fails closed when the panel snapshot has no design for the node", () => {
    const decision = remoteNodeDecision({ runnable: { id: "node-1", kind: "task" }, design: null });
    expect(decision.action).toBe("fail");
    expect(decision.reason).toContain("refresh the data source");
  });

  it("skips a closed branch and dispatches ordinary task and condition nodes", () => {
    expect(remoteNodeDecision({ runnable: { id: "node-1", kind: "task" }, design: taskNode, closable: true }).action).toBe("skip");
    expect(remoteNodeDecision({ runnable: { id: "node-1", kind: "task" }, design: taskNode }).action).toBe("task");
    expect(remoteNodeDecision({ runnable: { id: "node-1", kind: "condition" }, design: { ...taskNode, kind: "condition" } }).action).toBe("condition");
  });
});

describe("run guards", () => {
  it("uses the declared attempt budget and falls back to a single attempt", () => {
    expect(nodeAttemptBudget({ engineering: { maxAttempts: 3 } })).toBe(3);
    expect(nodeAttemptBudget({ engineering: {} })).toBe(1);
    expect(nodeAttemptBudget(undefined)).toBe(1);
    expect(nodeAttemptBudget({ engineering: { maxAttempts: 0 } })).toBe(1);
  });

  it("counts the wall-time limit from the run start", () => {
    const started = Date.parse("2026-08-11T00:00:00.000Z");
    expect(runWallDeadline({ maxWallSeconds: 60 }, "2026-08-11T00:00:00.000Z", started + 5_000)).toBe(started + 60_000);
  });

  it("counts from now when the run start is unreadable instead of dropping the limit", () => {
    const now = 1_000_000;
    expect(runWallDeadline({ maxWallSeconds: 30 }, undefined, now)).toBe(now + 30_000);
  });

  it("has no deadline when no limit is declared", () => {
    expect(runWallDeadline({}, "2026-08-11T00:00:00.000Z", 0)).toBeNull();
    expect(runWallDeadline({ maxWallSeconds: 0 }, "2026-08-11T00:00:00.000Z", 0)).toBeNull();
  });
});

describe("agent result contract", () => {
  it("reads a decorated failure line", () => {
    expect(dispatchedResultFailure("**RESULT: failed — 계약값 누락**\nturn 1")).toBe("계약값 누락");
    expect(dispatchedResultFailure("- RESULT: failed: 원인")).toBe("원인");
    expect(dispatchedResultFailure("```\nRESULT: failed\n```")).toBe("agent reported failed or blocked work");
  });

  it("treats a done line and a quoted instruction as success", () => {
    expect(dispatchedResultFailure("RESULT: done\n요약")).toBe("");
    expect(dispatchedResultFailure("make the first line exactly `RESULT: done` or `RESULT: failed — <reason>`")).toBe("");
  });

  it("does not scan past the opening lines", () => {
    const late = ["a", "b", "c", "d", "e", "f", "RESULT: failed — 늦은 줄"].join("\n");
    expect(dispatchedResultFailure(late)).toBe("");
  });
});

describe("node contract round-trip", () => {
  it("names every execution key the source did not store", () => {
    const submitted = { nodes: [{ id: "n1", label: "게이트", engineering: { role: "human_gate", maxAttempts: 2, layoutPinned: true } }] };
    const canonical = { nodes: [{ id: "n1", engineering: { layoutPinned: true } }] };
    expect(droppedNodeEngineering(submitted, canonical)).toEqual(["게이트: role, maxAttempts"]);
  });

  it("reports nothing when the source preserved the contract", () => {
    const submitted = { nodes: [{ id: "n1", engineering: { maxAttempts: 2 } }] };
    expect(droppedNodeEngineering(submitted, { nodes: [{ id: "n1", engineering: { maxAttempts: 2 } }] })).toEqual([]);
    expect(droppedNodeEngineering({ nodes: [{ id: "n1" }] }, { nodes: [] })).toEqual([]);
  });
});
