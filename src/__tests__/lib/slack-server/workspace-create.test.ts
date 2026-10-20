// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSlackWorkspace } from "@/lib/slack-server/workspace-create";

const REPOS = [{ repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();
const planMock = vi.fn();

function deps() {
  return { fetch: fetchMock as unknown as typeof fetch, plan: planMock };
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/repositories")) return jsonResponse({ repositories: REPOS });
    if (url.endsWith("/api/workspaces") && init?.method === "POST") {
      return jsonResponse({
        workspace: "bugfix-login-crash-20261020",
        workspacePath: "/root/workspace/bugfix-login-crash-20261020",
        repositories: [{ repoName: "web" }],
        problems: [],
        start: { kind: "none" },
      });
    }
    return jsonResponse({ error: "unexpected" }, 404);
  });
  planMock.mockReset().mockResolvedValue({
    repositories: ["github.com/acme/web"],
    taskType: "bugfix",
    name: "Fix login crash",
  });
});

describe("createSlackWorkspace", () => {
  it("plans from the cloned repositories and creates the workspace without a follow-up chat", async () => {
    const result = await createSlackWorkspace("http://localhost:3741", "fix the login crash", deps());

    expect(planMock).toHaveBeenCalledWith("fix the login crash", REPOS);
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/workspaces"))!;
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Fix login crash",
      taskType: "bugfix",
      repositories: ["github.com/acme/web"],
      note: "fix the login crash",
      followUp: false,
    });
    expect(result).toEqual({
      ok: true,
      workspace: "bugfix-login-crash-20261020",
      workspacePath: "/root/workspace/bugfix-login-crash-20261020",
      repositories: ["web"],
      problems: [],
    });
  });

  it("creates nothing when no repository could be told from the request", async () => {
    planMock.mockResolvedValueOnce({ repositories: [], taskType: "feature", name: "x" });

    const result = await createSlackWorkspace("http://localhost:3741", "make it better", deps());

    expect(result).toMatchObject({ ok: false, reason: "no-repositories" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/workspaces"))).toBe(false);
  });

  it("creates nothing when the planner gave no answer", async () => {
    planMock.mockResolvedValueOnce(null);

    const result = await createSlackWorkspace("http://localhost:3741", "fix it", deps());

    expect(result).toMatchObject({ ok: false, reason: "plan-failed" });
  });

  it("reports the server's refusal", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("/api/repositories")
        ? jsonResponse({ repositories: REPOS })
        : jsonResponse({ error: "Nothing to name the workspace by" }, 400),
    );

    const result = await createSlackWorkspace("http://localhost:3741", "fix it", deps());

    expect(result).toEqual({ ok: false, reason: "create-failed", error: "Nothing to name the workspace by" });
  });

  it("still plans when the repository list cannot be read, since the request may name one", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).endsWith("/api/repositories")
        ? jsonResponse({ error: "boom" }, 500)
        : init?.method === "POST"
          ? jsonResponse({ workspace: "w", workspacePath: "/w", repositories: [], problems: [], start: { kind: "none" } })
          : jsonResponse({}, 404),
    );

    await createSlackWorkspace("http://localhost:3741", "work on github.com/acme/web", deps());

    expect(planMock).toHaveBeenCalledWith("work on github.com/acme/web", []);
  });
});
