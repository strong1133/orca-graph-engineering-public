import { describe, expect, it, vi } from "vitest";
const {
  WorkTasksClient,
  mapOrcaRepos,
  normalizeWorkBranch,
  taskProjectInput,
  todoQuickTaskInput,
  validateWorkTasksBaseUrl,
  workTasksEnvironment,
} = await import(`../bridge/${["work", "tasks"].join("-")}-client.mjs`);
const sourceName = ["under", "joy"].join("");
const apiPath = `/api/plugins/${sourceName}-workspace`;
const clientHeader = ["X", `${sourceName[0]!.toUpperCase()}${sourceName.slice(1)}`, "MCP", "Client"].join("-");

describe("Work Tasks Hermes client", () => {
  it("reuses the short-lived dashboard session headers without exposing or persisting the token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push(init ? { url, init } : { url });
      if (url === "https://hermes.example.ts.net/") {
        return new Response('<script>window.__HERMES_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"</script>', { status: 200 });
      }
      return Response.json({ item: { environment: "정석맥1" } });
    });
    const client = new WorkTasksClient({
      baseUrl: "https://hermes.example.ts.net",
      clientId: "orca-plugin-test",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await client.put("/orca-projects/%EC%A0%95%EC%84%9D%EB%A7%A51", { projects: [] });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe(`https://hermes.example.ts.net${apiPath}/orca-projects/%EC%A0%95%EC%84%9D%EB%A7%A51`);
    expect((requests[1]?.init?.headers as Record<string, string>)["X-Hermes-Session-Token"]).toBe("abcdefghijklmnopqrstuvwxyz012345");
    expect((requests[1]?.init?.headers as Record<string, string>)[clientHeader]).toBe("orca-plugin-test");
  });

  it("passes work-process input byte-for-byte in the run JSON body", async () => {
    const original = "  첫 줄\r\n둘째 줄\n\n끝 공백  ";
    let requestBody = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith(".ts.net/")) {
        return new Response('window.__HERMES_SESSION_TOKEN__="abcdefghijklmnopqrstuvwxyz012345"', { status: 200 });
      }
      requestBody = String(init?.body ?? "");
      return Response.json({ item: { id: "GRAPH-1" } }, { status: 201 });
    });
    const client = new WorkTasksClient({ baseUrl: "https://hermes.example.ts.net", fetchImpl: fetchImpl as typeof fetch });
    await client.post("/graphs/GRAPH-1/runs", {
      expected_version: 7,
      trigger_kind: "manual",
      input_prompt: original,
    });
    expect(JSON.parse(requestBody).input_prompt).toBe(original);
  });

  it("keeps the same URL allow-list as the MCP adapter", () => {
    expect(validateWorkTasksBaseUrl("https://host.ts.net/")).toBe("https://host.ts.net");
    expect(() => validateWorkTasksBaseUrl("https://example.com")).toThrow("HTTPS *.ts.net");
    expect(validateWorkTasksBaseUrl("http://127.0.0.1:9000", { allowInsecureLoopback: true })).toBe("http://127.0.0.1:9000");
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
    expect(workTasksEnvironment(undefined, "jsj1")).toBe("정석맥1");
    expect(workTasksEnvironment(undefined, "jsj-mac-1.local")).toBe("정석맥1");
    expect(workTasksEnvironment(undefined, "jsj2-local")).toBe("정석맥2");
    expect(workTasksEnvironment(undefined, "jsj-mac-2.local")).toBe("정석맥2");
    expect(workTasksEnvironment(undefined, "jsj-air.local")).toBe("jsj-air");
    expect(workTasksEnvironment(undefined, "Hermes")).toBe("Hermes");
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
