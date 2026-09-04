import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PhaseFunctionContext, PipelinePhaseFunction } from "@/types/pipeline";

vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: vi.fn(),
}));

vi.mock("@/lib/workspace/worktree-refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/worktree-refresh")>();
  return { ...actual, refreshWorktrees: vi.fn() };
});

import { buildRefreshWorktreesPhase } from "@/lib/pipelines/actions/refresh-worktrees";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { refreshWorktrees } from "@/lib/workspace/worktree-refresh";
import type { WorktreeRefreshResult } from "@/lib/workspace/worktree-refresh";

const mockListRepos = vi.mocked(listWorkspaceRepos);
const mockRefresh = vi.mocked(refreshWorktrees);

function repo(repoName: string) {
  return {
    repoName,
    repoPath: `owner/${repoName}`,
    worktreePath: `/repos/${repoName}/worktrees/ws`,
  } as ReturnType<typeof listWorkspaceRepos>[number];
}

function result(
  repoName: string,
  status: WorktreeRefreshResult["status"],
): WorktreeRefreshResult {
  return {
    repoName,
    status,
    fromSha: "aaa",
    toSha: "bbb",
    upstream: "origin/x",
    detail: `${repoName}: ${status}`,
  };
}

function makeCtx() {
  return {
    operationId: "op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async () => ({})),
    emitTerminal: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => []),
    appendPhases: vi.fn(),
    signal: new AbortController().signal,
  } as unknown as PhaseFunctionContext;
}

async function run(
  phase: ReturnType<typeof buildRefreshWorktreesPhase>,
  ctx: PhaseFunctionContext,
) {
  return (phase as PipelinePhaseFunction).fn(ctx);
}

describe("buildRefreshWorktreesPhase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes every worktree in the workspace", async () => {
    mockListRepos.mockReturnValue([repo("svc"), repo("web")]);
    mockRefresh.mockReturnValue([result("svc", "fast-forwarded"), result("web", "up-to-date")]);

    const ctx = makeCtx();
    expect(await run(buildRefreshWorktreesPhase({ workspace: "ws" }), ctx)).toBe(true);

    expect(mockRefresh).toHaveBeenCalledWith([
      { repoName: "svc", worktreePath: "/repos/svc/worktrees/ws" },
      { repoName: "web", worktreePath: "/repos/web/worktrees/ws" },
    ]);
    expect(vi.mocked(ctx.emitResult).mock.calls[0][0]).toContain("- svc: fast-forwarded");
  });

  it("honours the single-repo filter the review shares", async () => {
    mockListRepos.mockReturnValue([repo("svc"), repo("web")]);
    mockRefresh.mockReturnValue([result("web", "up-to-date")]);

    await run(buildRefreshWorktreesPhase({ workspace: "ws", repository: "owner/web" }), makeCtx());

    expect(mockRefresh).toHaveBeenCalledWith([
      { repoName: "web", worktreePath: "/repos/web/worktrees/ws" },
    ]);
  });

  it("succeeds but says so when a worktree could not be moved", async () => {
    mockListRepos.mockReturnValue([repo("svc")]);
    mockRefresh.mockReturnValue([result("svc", "dirty")]);

    const ctx = makeCtx();
    // Best-effort on purpose: failing here would abort the operation before the
    // review, and a review of a slightly older commit beats no review at all.
    expect(await run(buildRefreshWorktreesPhase({ workspace: "ws" }), ctx)).toBe(true);

    const statuses = vi.mocked(ctx.emitStatus).mock.calls.map((c) => c[0]).join("\n");
    expect(statuses).toContain("does not read the pushed branch");
  });

  it("does nothing when the workspace has no repositories", async () => {
    mockListRepos.mockReturnValue([]);

    const ctx = makeCtx();
    expect(await run(buildRefreshWorktreesPhase({ workspace: "ws" }), ctx)).toBe(true);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(ctx.emitResult).toHaveBeenCalledWith("No repositories to refresh.");
  });
});
