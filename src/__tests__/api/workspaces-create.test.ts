// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateQuickWorkspace = vi.fn();
const mockSetupRepositories = vi.fn();

vi.mock("@/lib/workspace/quick-create", () => ({
  createQuickWorkspace: (...a: unknown[]) => mockCreateQuickWorkspace(...a),
  QuickCreateRefusal: class QuickCreateRefusal extends Error {},
}));

vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepositories: (...a: unknown[]) => mockSetupRepositories(...a),
}));

const mockStartTaskChat = vi.fn();
vi.mock("@/lib/chat-server/client", () => ({
  startTaskChatSession: (...a: unknown[]) => mockStartTaskChat(...a),
}));

const mockStartUserReview = vi.fn();
vi.mock("@/lib/pipelines/review", () => ({
  startUserReview: (...a: unknown[]) => mockStartUserReview(...a),
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
    pullRequests: [],
    problems: [],
    log: [],
  });
  mockStartTaskChat.mockReset().mockResolvedValue({ ok: true, sessionId: "chat-1" });
  mockStartUserReview.mockReset().mockResolvedValue({ id: "op-1" });
});

const PR = { url: "https://github.com/acme/web/pull/42", repoPath: "github.com/acme/web", headBranch: "fix" };

// The page that sent the request may be gone by the time it returns, so what
// follows a create is started here rather than left to it.
describe("POST /api/workspaces — what starts after the create", () => {
  it("starts a chat on the note, so it runs whether or not the page is still open", async () => {
    const response = await post({ name: "n", repositories: ["github.com/acme/web"], note: " fix the crash " });

    expect(mockStartTaskChat).toHaveBeenCalledWith("bugfix-login-crash-20260911", "fix the crash");
    await expect(response.json()).resolves.toMatchObject({ start: { kind: "chat", sessionId: "chat-1" } });
  });

  it("starts nothing when the caller runs what follows itself", async () => {
    mockCreateQuickWorkspace.mockResolvedValueOnce({
      workspace: "review-pr-42",
      workspacePath: "/ws/review-pr-42",
      repositories: [],
      pullRequests: [PR],
      problems: [],
      log: [],
    });
    const response = await post({
      name: "n",
      taskType: "review",
      repositories: [PR.url],
      note: "look at it",
      followUp: false,
    });

    expect(mockStartTaskChat).not.toHaveBeenCalled();
    expect(mockStartUserReview).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ start: { kind: "none" } });
  });

  it("starts no session without a note, which has nothing to hand it", async () => {
    const response = await post({ name: "n", repositories: ["github.com/acme/web"] });

    expect(mockStartTaskChat).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ start: { kind: "none" } });
  });

  it("starts a review instead when a review's PR became a worktree", async () => {
    mockCreateQuickWorkspace.mockResolvedValueOnce({
      workspace: "review-pr-42",
      workspacePath: "/ws/review-pr-42",
      pullRequests: [PR],
      repositories: [],
      problems: [],
      log: [],
    });
    const response = await post({ taskType: "review", repositories: [PR.url], note: "look" });

    expect(mockStartUserReview).toHaveBeenCalledWith("review-pr-42");
    expect(mockStartTaskChat).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ start: { kind: "review", operationId: "op-1" } });
  });

  it("starts a chat for a review whose PR did not become a worktree", async () => {
    await post({ taskType: "review", repositories: ["github.com/acme/web"], note: "look" });

    expect(mockStartUserReview).not.toHaveBeenCalled();
    expect(mockStartTaskChat).toHaveBeenCalled();
  });

  it("starts nothing when a repository failed, which is what to read first", async () => {
    mockCreateQuickWorkspace.mockResolvedValueOnce({
      workspace: "w",
      workspacePath: "/ws/w",
      repositories: [],
      pullRequests: [],
      problems: [{ repository: "github.com/acme/api", error: "clone failed" }],
      log: [],
    });
    const response = await post({ name: "n", repositories: ["github.com/acme/api"], note: "fix" });

    expect(mockStartTaskChat).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ start: { kind: "none" } });
  });

  it("still answers 200 with the workspace when the start fails, since the workspace exists", async () => {
    mockStartTaskChat.mockResolvedValueOnce({ ok: false, error: "Chat server unreachable" });
    const response = await post({ name: "n", repositories: ["github.com/acme/web"], note: "fix" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace: "bugfix-login-crash-20260911",
      start: { kind: "failed", what: "chat", error: "Chat server unreachable" },
    });
  });

  it("reports a review that could not start", async () => {
    mockCreateQuickWorkspace.mockResolvedValueOnce({
      workspace: "review-pr-42",
      workspacePath: "/ws/review-pr-42",
      repositories: [],
      pullRequests: [PR],
      problems: [],
      log: [],
    });
    mockStartUserReview.mockRejectedValueOnce(new Error("Too many operations"));
    const response = await post({ taskType: "review", repositories: [PR.url] });

    await expect(response.json()).resolves.toMatchObject({
      start: { kind: "failed", what: "review", error: expect.stringContaining("Too many operations") },
    });
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

// The form that sent a create may be closed and reopened while it runs; what it
// shows then comes from here, not from the request it no longer holds.
describe("POST /api/workspaces — progress a reopened form can read", () => {
  beforeEach(async () => {
    const { _resetQuickCreates } = await import("@/lib/workspace/quick-create-progress");
    _resetQuickCreates();
  });

  async function listed() {
    const { GET } = await import("@/app/api/quick-creates/route");
    return (await GET()).json();
  }

  it("lists the create as running with what setup has reported, then settles it with its start", async () => {
    let release: () => void = () => {};
    mockCreateQuickWorkspace.mockImplementationOnce(
      async (_input: unknown, deps: { onProgress: (m: string) => void }) => {
        deps.onProgress("[github.com/acme/web] Repository found locally, fetching latest...");
        await new Promise<void>((r) => (release = r));
        return {
          workspace: "bugfix-login-crash-20260911",
          workspacePath: "/ws/bugfix-login-crash-20260911",
          repositories: [],
          pullRequests: [],
          problems: [],
          log: [],
        };
      },
    );

    const pending = post({ name: "login crash", repositories: ["github.com/acme/web"], note: "fix" });
    await vi.waitFor(async () =>
      expect(await listed()).toMatchObject([
        {
          name: "login crash",
          state: "running",
          log: ["[github.com/acme/web] Repository found locally, fetching latest..."],
        },
      ]),
    );

    release();
    await pending;
    expect(await listed()).toMatchObject([
      { state: "done", workspace: "bugfix-login-crash-20260911", start: { kind: "chat", sessionId: "chat-1" } },
    ]);
  });

  it("settles a create that threw as failed, so the form stops waiting on it", async () => {
    mockCreateQuickWorkspace.mockRejectedValueOnce(new Error("disk full"));
    await post({ name: "n", repositories: ["github.com/acme/web"] });

    expect(await listed()).toMatchObject([{ state: "failed", error: expect.stringContaining("disk full") }]);
  });

  it("leaves out a refused create, which made nothing", async () => {
    const { QuickCreateRefusal } = await import("@/lib/workspace/quick-create");
    mockCreateQuickWorkspace.mockRejectedValueOnce(new QuickCreateRefusal("Nothing to name it by"));
    await post({ repositories: ["https://github.com/acme/web/pull/42"] });

    expect(await listed()).toEqual([]);
  });

  it("leaves out a create no form is waiting on", async () => {
    await post({ name: "n", repositories: ["github.com/acme/web"], followUp: false });

    expect(await listed()).toEqual([]);
  });
});
