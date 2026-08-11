import { describe, expect, it } from "vitest";
import { analyzeGraph, applyTopologyTemplate, autoLayout, cloneGraph, effectiveRouting, graphCallDefaults, modelReasoningLevels, normalizeGraphStore, reasoningRouteError, topologicalOrder, validateGraph, validateGraphLinks, type GraphDefinition, type OrcaTargets } from "../src/model";
import { graphFromValidationFixture, validationFixtureCases } from "./validation-fixtures";

function graph(): GraphDefinition {
  return {
    id: "graph-1",
    name: "test",
    summary: "",
    status: "draft",
    version: 1,
    pinned: false,
    processEnabled: false,
    routineEnabled: false,
    repeatMode: "none",
    defaults: { projectId: "project-a", sessionId: "session-graph", model: "gpt-default", reasoning: "high" },
    runGuards: {},
    nodes: [
      {
        id: "a",
        kind: "task",
        label: "A",
        x: 0,
        y: 0,
        status: "pending",
        joinMode: "all",
        task: { id: "ta", title: "A", prompt: "do A" },
        routing: { sessionId: "session-node", model: "gpt-node" },
      },
      {
        id: "b",
        kind: "task",
        label: "B",
        x: 0,
        y: 0,
        status: "pending",
        joinMode: "all",
        task: { id: "tb", title: "B", prompt: "do B" },
      },
    ],
    edges: [{ id: "e", from: "a", to: "b", kind: "sequence" }],
    runs: [],
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

describe("routing inheritance", () => {
  it("lets node values override only the fields they set", () => {
    const item = graph();
    const route = effectiveRouting(item, item.nodes[0]!);
    expect(route.projectId).toBe("project-a");
    expect(route.sessionId).toBe("session-node");
    expect(route.model).toBe("gpt-node");
    expect(route.reasoning).toBe("high");
    expect(route.sources).toMatchObject({
      projectId: "graph",
      sessionId: "node",
      model: "node",
      reasoning: "graph",
    });
  });

  it("inherits the selected Orca worktree branch", () => {
    const item = graph();
    item.defaults.branch = "refs/heads/feature/default";
    item.nodes[0]!.routing = { branch: "refs/heads/feature/node" };
    expect(effectiveRouting(item, item.nodes[0]!).branch).toBe("refs/heads/feature/node");
    expect(effectiveRouting(item, item.nodes[1]!).branch).toBe("refs/heads/feature/default");
  });
});

describe("work process projection", () => {
  it("preserves process identity and immutable run input through normalization", () => {
    const item = graph();
    item.processEnabled = true;
    item.runs = [{
      id: "run-process", runNo: 3, status: "running", startedAt: "2026-08-10T00:00:00Z",
      inputPrompt: "  원문\n그대로  ",
    }];
    const normalized = normalizeGraphStore({
      schemaVersion: 1, activeGraphId: item.id, graphs: [item], domains: [], milestones: [], tasks: [], todos: [],
    });
    expect(normalized.graphs[0]).toMatchObject({
      processEnabled: true,
      runs: [{ inputPrompt: "  원문\n그대로  " }],
    });
  });
});

describe("graph structure", () => {
  it("orders non-loop edges and ignores intentional loopbacks", () => {
    const item = graph();
    item.edges.push({ id: "loop", from: "b", to: "a", kind: "loop" });
    expect(topologicalOrder(item)).toEqual(["a", "b"]);
  });

  it("flags ordinary cycles", () => {
    const item = graph();
    item.edges.push({ id: "cycle", from: "b", to: "a", kind: "sequence" });
    expect(validateGraph(item)).toContain("loop으로 표시되지 않은 순환 연결이 있습니다.");
  });

  it("places dependent nodes in separate columns", () => {
    const laidOut = autoLayout(graph());
    expect(laidOut.nodes[1]!.x).toBeGreaterThan(laidOut.nodes[0]!.x);
  });

  it("keeps pinned nodes fixed while laying out the remaining graph", () => {
    const item = graph();
    item.nodes[0]!.x = 777;
    item.nodes[0]!.y = 333;
    item.nodes[0]!.engineering = { layoutPinned: true };
    item.nodes[1]!.x = 777;
    item.nodes[1]!.y = 333;
    const laidOut = autoLayout(item, "LR", { preservePinned: true });
    expect(laidOut.nodes[0]).toMatchObject({ x: 777, y: 333, engineering: { layoutPinned: true } });
    expect(laidOut.nodes[1]!.x).not.toBe(777);
  });

  it("clones structure while resetting execution state", () => {
    const item = graph();
    item.nodes[0]!.status = "done";
    item.runs.push({ id: "run", runNo: 1, status: "done", startedAt: "x" });
    const cloned = cloneGraph(item, "graph-2");
    expect(cloned.id).toBe("graph-2");
    expect(cloned.nodes.every((node) => node.status === "pending")).toBe(true);
    expect(cloned.runs).toEqual([]);
    expect(cloned.edges[0]!.from).not.toBe("a");
  });

  it("computes supersteps and the critical path", () => {
    const item = graph();
    const c = structuredClone(item.nodes[1]!);
    c.id = "c";
    c.label = "C";
    item.nodes.push(c);
    item.edges.push({ id: "e2", from: "a", to: "c", kind: "sequence" });
    const analysis = analyzeGraph(item);
    expect(analysis.supersteps).toEqual([["a"], ["b", "c"]]);
    expect(analysis.maxParallelism).toBe(2);
    expect(analysis.criticalPathNodeIds[0]).toBe("a");
  });

  it("requires a reducer for parallel writes", () => {
    const item = graph();
    const c = structuredClone(item.nodes[1]!);
    c.id = "c";
    c.label = "C";
    item.nodes.push(c);
    item.edges.push({ id: "e2", from: "a", to: "c", kind: "sequence" });
    item.nodes[1]!.engineering = { writes: ["result"] };
    item.nodes[2]!.engineering = { writes: ["result"] };
    expect(analyzeGraph(item).findings.some((finding) => finding.chapter === 19 && finding.severity === "error")).toBe(true);
  });

  it("requires all four loop guards", () => {
    const item = graph();
    item.nodes[1]!.kind = "condition";
    item.nodes[1]!.conditionExpr = "retry?";
    item.edges.push({ id: "loop", from: "b", to: "a", kind: "loop", branch: "retry" });
    expect(analyzeGraph(item).findings.some((finding) => finding.chapter === 20 && finding.message.includes("루프 안전장치"))).toBe(true);
  });

  it("rejects condition selections that do not match an outgoing branch", () => {
    const item = graph();
    item.nodes[0]!.kind = "condition";
    item.nodes[0]!.conditionExpr = "continue?";
    item.nodes[0]!.branchTaken = "n";
    item.edges[0]!.branch = "y";

    expect(validateGraph(item)).toContain("A: 선택한 분기 'n'와 일치하는 출력 엣지가 없습니다.");

    delete item.edges[0]!.branch;
    expect(validateGraph(item)).toContain("A: 모든 출력 엣지에 조건 분기 라벨이 필요합니다.");
  });

  it("requires loop edges to be labelled condition back-edges", () => {
    const item = graph();
    item.edges.push({ id: "bad-loop", from: "a", to: "b", kind: "loop" });
    const messages = validateGraph(item);
    expect(messages).toContain("bad-loop: loop 엣지는 조건 노드에서 시작해야 합니다.");
    expect(messages).toContain("bad-loop: loop 엣지에 종료 판정과 구별되는 분기 라벨이 필요합니다.");
    expect(messages).toContain("bad-loop: loop 엣지는 현재 경로의 선행 노드로 되돌아가야 합니다.");

    item.nodes[1]!.kind = "condition";
    item.nodes[1]!.conditionExpr = "retry?";
    item.edges[1] = { id: "bad-loop", from: "b", to: "a", kind: "loop", branch: "retry" };
    expect(validateGraph(item)).not.toContain("bad-loop: loop 엣지는 현재 경로의 선행 노드로 되돌아가야 합니다.");
  });

  it("creates an instrumented diamond topology", () => {
    const templated = applyTopologyTemplate(graph(), "diamond");
    expect(templated.nodes).toHaveLength(5);
    expect(templated.nodes.some((node) => node.engineering?.role === "verifier" && node.engineering.contextMode === "fresh")).toBe(true);
    expect(analyzeGraph(templated).maxParallelism).toBe(2);
  });

  it("uses an OR join when mutually exclusive router branches converge", () => {
    const templated = applyTopologyTemplate(graph(), "router");
    const merge = templated.nodes.find((node) => node.engineering?.role === "merge");
    expect(merge?.joinMode).toBe("any");
  });
});

describe("shared graph validation matrix", () => {
  for (const item of validationFixtureCases) {
    it(`${item.id} keeps normalized model severity aligned with the validation contract`, () => {
      const findings = analyzeGraph(graphFromValidationFixture(item), { live: item.runMode === "live" }).findings;
      if (!item.expected.code) {
        expect(findings.filter((finding) => finding.severity === "error").map((finding) => finding.code))
          .not.toContain("IRREVERSIBLE_GATE_DOMINATOR_REQUIRED");
        return;
      }
      expect(findings.find((finding) => finding.code === item.expected.code)?.severity)
        .toBe(item.expected.severity);
    });
  }
});

describe("agent reasoning capabilities", () => {
  const targets: OrcaTargets = {
    refreshedAt: null,
    projects: [],
    sessions: [],
    models: [
      { id: "gpt-5.6-sol", label: "Sol", agent: "codex", reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"] },
      { id: "gpt-5.6-luna", label: "Luna", agent: "codex", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
      { id: "claude-opus-5", label: "Opus", agent: "claude", reasoningLevels: ["low", "medium", "high", "xhigh", "max"] },
    ],
  };

  it("keeps Claude and Codex model capability sets explicit", () => {
    expect(modelReasoningLevels(targets, "claude-opus-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(modelReasoningLevels(targets, "gpt-5.6-sol")).toContain("ultra");
    expect(modelReasoningLevels(targets, "gpt-5.6-luna")).not.toContain("ultra");
  });

  it("rejects unsupported levels and existing-session overrides", () => {
    expect(reasoningRouteError({ model: "claude-opus-5", reasoning: "ultra" }, targets)).toMatchObject({
      code: "REASONING_LEVEL_UNSUPPORTED",
    });
    expect(reasoningRouteError({ model: "gpt-5.6-sol", reasoning: "ultra" }, targets)).toBeNull();
    expect(reasoningRouteError({ sessionId: "session", reasoning: "high" }, targets, { existingSession: true })).toMatchObject({
      code: "EXISTING_SESSION_REASONING_OVERRIDE_UNSUPPORTED",
    });
  });

  it("surfaces an existing-session override as a blocking model finding", () => {
    const item = graph();
    item.defaults = { sessionId: "session", reasoning: "high" };
    const finding = analyzeGraph(item, { targets }).findings.find((candidate) => candidate.code === "EXISTING_SESSION_REASONING_OVERRIDE_UNSUPPORTED");
    expect(finding?.severity).toBe("error");
  });
});

describe("graph-to-graph links", () => {
  it("combines parent, call-node, and child routing by policy", () => {
    const parent = graph();
    const child = graph();
    child.id = "graph-child";
    child.defaults = { sessionId: "session-child", model: "child-model" };
    const call = {
      id: "call",
      kind: "graph_call" as const,
      label: "Child",
      x: 0,
      y: 0,
      status: "pending" as const,
      joinMode: "all" as const,
      childGraphId: child.id,
      graphCallRoutingMode: "override" as const,
      routing: { model: "call-model" },
    };
    expect(graphCallDefaults(parent, call, child)).toMatchObject({
      projectId: "project-a",
      sessionId: "session-child",
      model: "call-model",
      reasoning: "high",
    });
  });

  it("reports missing targets and every member of a call cycle", () => {
    const parent = graph();
    const child = graph();
    child.id = "graph-child";
    parent.nodes = [{
      id: "call-child", kind: "graph_call", label: "Call child", x: 0, y: 0,
      status: "pending", joinMode: "all", childGraphId: child.id,
    }];
    parent.edges = [];
    child.nodes = [{
      id: "call-parent", kind: "graph_call", label: "Call parent", x: 0, y: 0,
      status: "pending", joinMode: "all", childGraphId: parent.id,
    }];
    child.edges = [];
    const cycle = validateGraphLinks([parent, child]);
    expect(cycle.filter((finding) => finding.severity === "error").map((finding) => finding.graphId).sort()).toEqual(["graph-1", "graph-child"]);

    child.nodes[0]!.childGraphId = "missing";
    expect(validateGraphLinks([parent, child]).some((finding) => finding.graphId === child.id && finding.nodeId === "call-parent")).toBe(true);
  });
});

describe("public store normalization", () => {
  it("round-trips portable editor metadata inside the v1 engineering extension", () => {
    const item = graph();
    item.engineering = {
      editor: {
        groupBy: "domain",
        edgeWaypoints: { e: [{ x: 120, y: 80 }, { x: Number.NaN, y: 20 }] },
      },
    };
    item.nodes[0]!.engineering = { layoutPinned: true };
    const normalized = normalizeGraphStore({ schemaVersion: 1, activeGraphId: item.id, graphs: [item] });
    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.graphs[0]!.engineering?.editor).toEqual({
      groupBy: "domain",
      edgeWaypoints: { e: [{ x: 120, y: 80 }] },
    });
    expect(normalized.graphs[0]!.nodes[0]!.engineering?.layoutPinned).toBe(true);
  });

  it("keeps only fields declared by the public schema", () => {
    const item = graph() as GraphDefinition & Record<string, unknown>;
    item.internalOnly = true;
    (item.nodes[0] as GraphDefinition["nodes"][number] & Record<string, unknown>).internalOnly = true;
    (item.nodes[0]!.task as NonNullable<GraphDefinition["nodes"][number]["task"]> & Record<string, unknown>).internalOnly = true;
    const normalized = normalizeGraphStore({ schemaVersion: 1, activeGraphId: item.id, graphs: [item] });
    expect(normalized.graphs[0]).not.toHaveProperty("internalOnly");
    expect(normalized.graphs[0]!.nodes[0]).not.toHaveProperty("internalOnly");
    expect(normalized.graphs[0]!.nodes[0]!.task).not.toHaveProperty("internalOnly");
  });

  it("migrates embedded node tasks into the local Task library without changing schema v1", () => {
    const item = graph();
    const normalized = normalizeGraphStore({
      schemaVersion: 1,
      activeGraphId: item.id,
      graphs: [item],
      todos: [{
        id: "todo-1", title: "Review", notes: "Review the result", status: "open", priority: "high",
        groupName: "Quality", subgroupName: "Review",
        draft: "Review the result", promptRevisions: [],
        tags: ["quality"], taskId: "ta", createdAt: item.createdAt, updatedAt: item.updatedAt,
      }],
    });

    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.tasks.map((task) => task.id)).toEqual(["ta", "tb"]);
    expect(normalized.tasks[0]).toMatchObject({ title: "A", status: "ready", priority: "medium" });
    expect(normalized.todos[0]).toMatchObject({
      id: "todo-1", taskId: "ta", priority: "high", groupName: "Quality", subgroupName: "Review",
    });
  });

  it("normalizes Domain and Milestone scope and migrates Draft prompt history", () => {
    const item = graph();
    const normalized = normalizeGraphStore({
      schemaVersion: 1,
      activeGraphId: item.id,
      graphs: [item],
      domains: [{
        id: "domain-1", name: "Product", summary: "", objectives: "", commonNotes: "", constraintNotes: "",
        status: "active", owners: [], version: 1, createdAt: item.createdAt, updatedAt: item.updatedAt,
      }],
      milestones: [{
        id: "milestone-1", domainId: "domain-1", name: "Release", summary: "", objectives: "", commonNotes: "", constraintNotes: "",
        status: "active", priority: "high", successCriteria: [], owners: [], version: 1, createdAt: item.createdAt, updatedAt: item.updatedAt,
      }],
      tasks: [{
        id: "scoped-task", title: "Scoped", prompt: "legacy human draft", domainId: "wrong-domain", milestoneId: "milestone-1",
        draft: "", promptRevisions: [], status: "ready", priority: "medium", tags: [], createdAt: item.createdAt, updatedAt: item.updatedAt,
      }],
    });

    expect(normalized.tasks[0]).toMatchObject({
      domainId: "domain-1",
      milestoneId: "milestone-1",
      draft: "legacy human draft",
      prompt: "legacy human draft",
    });
    expect(normalized.tasks[0]?.promptRevisions).toEqual([
      expect.objectContaining({ kind: "draft", status: "current", content: "legacy human draft" }),
    ]);
  });

  it("does not make a stale Meta Draft current after reload", () => {
    const item = graph();
    const normalized = normalizeGraphStore({
      schemaVersion: 1,
      activeGraphId: item.id,
      graphs: [item],
      tasks: [{
        id: "task-stale", title: "Stale", prompt: "new human", draft: "new human", metaDraft: "old meta",
        promptRevisions: [
          { id: "draft-old", kind: "draft", revision: 1, content: "old human", status: "stale", generator: "human", createdAt: item.createdAt },
          { id: "meta-old", kind: "meta", revision: 2, content: "old meta", status: "stale", basedOnId: "draft-old", generator: "meta-prompt-agent", createdAt: item.createdAt },
          { id: "draft-new", kind: "draft", revision: 3, content: "new human", status: "current", generator: "human", createdAt: item.updatedAt },
        ],
        status: "ready", priority: "medium", tags: [], createdAt: item.createdAt, updatedAt: item.updatedAt,
      }],
    });
    expect(normalized.tasks[0]?.prompt).toBe("new human");
    expect(normalized.tasks[0]?.metaDraft).toBe("old meta");
    expect(normalized.tasks[0]?.promptRevisions.filter((revision) => revision.kind === "meta" && revision.status === "current")).toEqual([]);
  });
});
