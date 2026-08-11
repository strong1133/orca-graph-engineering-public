import { describe, expect, it, vi } from "vitest";
const {
  WorkTasksClient,
  mapOrcaRepos,
  normalizeWorkBranch,
  taskProjectInput,
  todoQuickTaskInput,
  validateWorkTasksBaseUrl,
  workTasksClientFromDataSource,
  workTasksEnvironment,
} = await import("../lib/workspace-client.mjs");
const apiPath = "/api/plugins/orca-graph-engineering";
// 세션 bootstrap 은 원천이 base page 에 토큰을 심는 배포에서만 쓴다. 변수 이름을
// 설정하지 않으면 시도조차 하지 않는 것이 새 계약이다.
process.env.ORCA_GRAPH_WORKSPACE_SESSION_TOKEN_VAR = "window.__WORKSPACE_SESSION_TOKEN__";
const clientHeader = "X-Orca-Graph-Client";

describe("workspace client", () => {
  it("reuses the short-lived dashboard session headers without exposing or persisting the token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(init ? { url, init } : { url });
      if (url === "https://workspace.example.com/") {
        return new Response('<script>window.__WORKSPACE_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"</script>', { status: 200 });
      }
      return Response.json({ item: { environment: "device-a" } });
    });
    const client = new WorkTasksClient({
      baseUrl: "https://workspace.example.com",
      clientId: "orca-plugin-test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.put("/orca-projects/device-a", { projects: [] });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe(`https://workspace.example.com${apiPath}/orca-projects/device-a`);
    expect((requests[1]?.init?.headers as Record<string, string>)["X-Session-Token"]).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect((requests[1]?.init?.headers as Record<string, string>)[clientHeader]).toBe("orca-plugin-test");
  });

  it("passes work-process input byte-for-byte in the run JSON body", async () => {
    const original = "  첫 줄\r\n둘째 줄\n\n끝 공백  ";
    let requestBody = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("workspace.example.com/")) {
        return new Response('window.__WORKSPACE_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"', { status: 200 });
      }
      requestBody = String(init?.body ?? "");
      return Response.json({ item: { id: "GRAPH-1" } }, { status: 201 });
    });
    const client = new WorkTasksClient({ baseUrl: "https://workspace.example.com", fetchImpl: fetchImpl as typeof fetch });
    await client.post("/graphs/GRAPH-1/runs", {
      expected_version: 7,
      trigger_kind: "manual",
      input_prompt: original,
    });
    expect(JSON.parse(requestBody).input_prompt).toBe(original);
  });

  it("keeps the same URL allow-list as the MCP adapter", () => {
    expect(validateWorkTasksBaseUrl("https://host.example.com/")).toBe("https://host.example.com");
    expect(() => validateWorkTasksBaseUrl("http://example.com")).toThrow("must be HTTPS");
    expect(validateWorkTasksBaseUrl("http://127.0.0.1:9000", { allowInsecureLoopback: true })).toBe("http://127.0.0.1:9000");
  });

  it("reuses the exact structured workspace endpoint for project and Task operations", () => {
    const client = workTasksClientFromDataSource({
      schemaVersion: 1,
      mode: "structured",
      url: `https://workspace.example.com${apiPath}/`,
      authEnv: "ORCA_GRAPH_SOURCE_TOKEN",
    });
    expect(client?.baseUrl).toBe("https://workspace.example.com");
    expect(client?.apiBase).toBe(`https://workspace.example.com${apiPath}`);

    const loopback = workTasksClientFromDataSource({
      schemaVersion: 1,
      mode: "structured",
      url: `http://127.0.0.1:9000${apiPath}`,
    });
    expect(loopback?.baseUrl).toBe("http://127.0.0.1:9000");
  });

  it("does not treat unrelated structured sources as a workspace API", () => {
    expect(workTasksClientFromDataSource({ mode: "structured", url: "https://workspace.example.com/other" })).toBeNull();
    expect(workTasksClientFromDataSource({ mode: "structured", url: "https://example.com/api/plugins/other" })).toBeNull();
    expect(workTasksClientFromDataSource({ mode: "unstructured", url: `https://workspace.example.com${apiPath}` })).toBeNull();
  });
});

describe("Orca project registry mapping", () => {
  it("maps the authoritative Orca repo and worktree list fields without inventing values", () => {
    expect(mapOrcaRepos({ repos: [{
      id: "repo-1", displayName: "work", path: "/workspace/work", kind: "git",
      gitRemoteIdentity: { canonicalKey: "github.com/acme/work" },
    }] }, { worktrees: [{
      id: "repo-1::/workspace/worktree", repoId: "repo-1", path: "/workspace/worktree",
      branch: "refs/heads/feature/card-picker", displayName: "card picker", isMainWorktree: false,
    }] })).toEqual([{
      name: "work", path: "/workspace/work", kind: "git", repo_id: "repo-1", remote: "github.com/acme/work",
      worktrees: [{
        id: "repo-1::/workspace/worktree", path: "/workspace/worktree",
        branch: "feature/card-picker", display_name: "card picker",
      }],
    }]);
  });

  it("maps device aliases and relation shapes to the fixed server contract", () => {
    // 명시한 이름이 우선이고, 없으면 이 장치의 이름을 그대로 쓴다. 코드가 아는
    // 장치 목록은 없다 — 목록이 있으면 거기 없는 설치본은 아예 쓸 수 없다.
    expect(workTasksEnvironment("build-box")).toBe("build-box");
    expect(workTasksEnvironment("", "laptop-1.local")).toBe("laptop-1.local");
    expect(workTasksEnvironment(undefined, "  desk-2  ")).toBe("desk-2");
    expect(workTasksEnvironment(undefined, "")).toBeNull();
    expect(taskProjectInput({
      id: "TP-1", role: "target", locatorKind: "folder", locator: "/workspace/work",
      label: "work", branch: "refs/heads/feature/task-42", position: 2,
    })).toEqual({
      id: "TP-1", role: "target", locator_kind: "folder", locator: "/workspace/work",
      label: "work", branch: "feature/task-42", position: 2,
    });
    expect(normalizeWorkBranch("refs/heads/feature/task-42")).toBe("feature/task-42");
    expect(() => normalizeWorkBranch("feature/bad branch")).toThrow("safe Git branch");
    expect(() => normalizeWorkBranch("feature/bad\u0000branch")).toThrow("safe Git branch");
    for (const unsafe of ["-bad", "feature..bad", "feature@{bad", "feature//bad", "feature/bad.", "feature/bad/"]) {
      expect(() => normalizeWorkBranch(unsafe)).toThrow("safe Git branch");
    }
  });

  it("maps a Todo to the atomic quick-Task contract without changing its source bytes", () => {
    const content = "  첫 줄\r\n둘째 줄\n끝 공백  ";
    expect(todoQuickTaskInput({
      id: "TODO-1", content, memo: "  원문 메모  ", due_on: "2026-08-11", priority: "normal",
    })).toEqual({
      title: "첫 줄\r\n둘째 줄\n끝 공백",
      description: "  원문 메모  ",
      due_on: "2026-08-11",
      priority: "normal",
      draft: content,
    });
  });

  it("fails before publishing values outside the registry contract", () => {
    expect(() => mapOrcaRepos({ repos: [{ displayName: "x".repeat(201), path: "/workspace/work" }] }))
      .toThrow("displayName exceeds 200");
    expect(() => mapOrcaRepos({ repos: Array.from({ length: 501 }, (_, index) => ({
      id: `repo-${index}`, displayName: `repo-${index}`, path: `/workspace/${index}`,
    })) })).toThrow("limit of 500");
  });
});
