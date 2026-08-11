import { describe, expect, it } from "vitest";
import { droppedNodeEngineering } from "../lib/node-engineering.mjs";

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
