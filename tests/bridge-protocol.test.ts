import { describe, expect, it } from "vitest";
import { encodeBridgeFrames, parseBridgeFrame } from "../src/bridge-protocol";

describe("bridge protocol", () => {
  it("chunks large payloads below the terminal text ceiling", () => {
    const frames = encodeBridgeFrames({ type: "save", value: "가".repeat(5000) }, 900);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.every((frame) => frame.length < 1000)).toBe(true);
    const parsed = frames.map(parseBridgeFrame);
    expect(parsed.every(Boolean)).toBe(true);
    expect(parsed[0]?.total).toBe(frames.length);
  });

  it("rejects malformed or inconsistent frames", () => {
    expect(parseBridgeFrame("hello")).toBeNull();
    expect(parseBridgeFrame("OGX1:id:2:1:data")).toBeNull();
  });
});

