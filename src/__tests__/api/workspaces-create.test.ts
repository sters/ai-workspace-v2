// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateQuickWorkspace = vi.fn();
const mockSetupRepository = vi.fn();
const mockListSelectableRepositories = vi.fn();

vi.mock("@/lib/workspace/quick-create", () => ({
  createQuickWorkspace: (...a: unknown[]) => mockCreateQuickWorkspace(...a),
  listSelectableRepositories: () => mockListSelectableRepositories(),
}));

vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: (...a: unknown[]) => mockSetupRepository(...a),
}));

vi.mock("@/lib/workspace/reader", () => ({
  listWorkspaceItems: vi.fn(async () => ({ workspaces: [], olderCount: 0, archivedCount: 0 })),
}));

async function post(body: unknown) {
  const { POST } = await import("@/app/api/workspaces/route");
  return POST(
    new Request("http://localhost:3741/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  mockCreateQuickWorkspace.mockReset().mockResolvedValue({
    workspace: "bugfix-login-crash-20260911",
    workspacePath: "/ws/bugfix-login-crash-20260911",
    repositories: [],
    problems: [],
    log: [],
  });
  mockListSelectableRepositories.mockReset().mockReturnValue([]);
});

describe("POST /api/workspaces", () => {
  it("creates the workspace and returns its name", async () => {
    const response = await post({
      name: "login crash",
      taskType: "bugfix",
      repositories: ["github.com/acme/web"],
      note: "fix it",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace: "bugfix-login-crash-20260911",
    });
    expect(mockCreateQuickWorkspace).toHaveBeenCalledWith(
      {
        name: "login crash",
        taskType: "bugfix",
        repositories: ["github.com/acme/web"],
        note: "fix it",
      },
      expect.objectContaining({ setupRepository: expect.any(Function) }),
    );
  });

  it("defaults the task type to bugfix", async () => {
    await post({ name: "n", repositories: ["github.com/acme/web"] });
    expect(mockCreateQuickWorkspace.mock.calls[0][0].taskType).toBe("bugfix");
  });

  it("drops a repository listed twice", async () => {
    await post({
      name: "n",
      repositories: ["github.com/acme/web", "github.com/acme/web", "github.com/acme/api"],
    });
    expect(mockCreateQuickWorkspace.mock.calls[0][0].repositories).toEqual([
      "github.com/acme/web",
      "github.com/acme/api",
    ]);
  });

  it("rejects a missing name", async () => {
    const response = await post({ repositories: ["github.com/acme/web"] });
    expect(response.status).toBe(400);
    expect(mockCreateQuickWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an empty repository selection", async () => {
    const response = await post({ name: "n", repositories: [] });
    expect(response.status).toBe(400);
    expect(mockCreateQuickWorkspace).not.toHaveBeenCalled();
  });

  it("rejects an unknown task type", async () => {
    const response = await post({ name: "n", taskType: "chore", repositories: ["github.com/acme/web"] });
    expect(response.status).toBe(400);
  });

  it("reports a failure as 500", async () => {
    mockCreateQuickWorkspace.mockRejectedValue(new Error("disk full"));
    const response = await post({ name: "n", repositories: ["github.com/acme/web"] });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("disk full") });
  });
});

describe("GET /api/repositories", () => {
  it("lists the cloned repositories", async () => {
    mockListSelectableRepositories.mockReturnValue([
      { repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" },
    ]);
    const { GET } = await import("@/app/api/repositories/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repositories: [{ repoPath: "github.com/acme/web", repoName: "web", baseBranch: "main" }],
    });
  });

  it("reports a listing failure as 500", async () => {
    mockListSelectableRepositories.mockImplementation(() => {
      throw new Error("no repositories dir");
    });
    const { GET } = await import("@/app/api/repositories/route");
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
