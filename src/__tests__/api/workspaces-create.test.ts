// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateQuickWorkspace = vi.fn();
const mockSetupRepository = vi.fn();

vi.mock("@/lib/workspace/quick-create", () => ({
  createQuickWorkspace: (...a: unknown[]) => mockCreateQuickWorkspace(...a),
  QuickCreateRefusal: class QuickCreateRefusal extends Error {},
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
});

describe("POST /api/workspaces", () => {

  it("defaults the task type to feature", async () => {
    await post({ name: "n", repositories: ["github.com/acme/web"] });
    expect(mockCreateQuickWorkspace.mock.calls[0][0].taskType).toBe("feature");
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

  it("reports a failure as 500", async () => {
    mockCreateQuickWorkspace.mockRejectedValue(new Error("disk full"));
    const response = await post({ name: "n", repositories: ["github.com/acme/web"] });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("disk full") });
  });

  it("reports a refusal as 400, since nothing was created", async () => {
    const { QuickCreateRefusal } = await import("@/lib/workspace/quick-create");
    mockCreateQuickWorkspace.mockRejectedValue(new QuickCreateRefusal("Nothing to name it by"));
    const response = await post({ repositories: ["https://github.com/acme/web/pull/42"] });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Nothing to name it by" });
  });
});
