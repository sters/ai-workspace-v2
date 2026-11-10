// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { isWorkspaceArchived } from "@/lib/db/archives";
import { getPrSnapshot, listPrEvents } from "@/lib/db/pr-watch";
import { archiveWorkspaceWithPrs, OpenPullRequestsError, type ArchiveDeps } from "@/lib/workspace/archive";
import type { WorkspacePullRequest } from "@/types/pull-request";

function pr(state: string, repoName = "widgets"): WorkspacePullRequest {
  return {
    repoName, repoPath: `github.com/acme/${repoName}`, worktreePath: `/ws/${repoName}`,
    host: "github.com", owner: "acme", repo: repoName, number: 1,
    url: `https://github.com/acme/${repoName}/pull/1`, title: "t", state, isDraft: false,
    headRefName: "feat", headSha: "aaa", baseRefName: "main", author: "me", updatedAt: "",
    mergeable: "MERGEABLE", threads: [],
    checks: { checks: [], counts: { success: 0, failure: 0, running: 0, queued: 0, skipped: 0, cancelled: 0, unknown: 0 }, reported: false },
  };
}

function deps(prs: WorkspacePullRequest[], overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    listPullRequests: async () => prs,
    closePullRequest: vi.fn(async () => {}),
    deleteBranch: vi.fn(async () => {}),
    startHarvest: vi.fn(() => "op-1"),
    ...overrides,
  };
}

describe("archiveWorkspaceWithPrs", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("refuses to archive with open PRs unless asked to close them", async () => {
    const d = deps([pr("OPEN"), pr("MERGED", "other")]);
    await expect(archiveWorkspaceWithPrs("ws", {}, d)).rejects.toBeInstanceOf(OpenPullRequestsError);
    expect(isWorkspaceArchived("ws")).toBe(false);
    expect(d.closePullRequest).not.toHaveBeenCalled();
    expect(d.startHarvest).not.toHaveBeenCalled();
  });

  it("closes open PRs, deletes their branches, marks the close as aiw's, then archives and harvests", async () => {
    const d = deps([pr("OPEN")]);
    const result = await archiveWorkspaceWithPrs("ws", { closeOpenPrs: true }, d);
    expect(d.deleteBranch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ closed: [pr("OPEN").url], warnings: [], harvest: { operationId: "op-1" } });
    expect(isWorkspaceArchived("ws")).toBe(true);
    expect(listPrEvents("ws").map((e) => e.kind)).toEqual(["closed-by-archive"]);
    // The watcher must not later report this close as a reviewer's.
    expect(getPrSnapshot("ws", "widgets")?.state).toBe("CLOSED");
  });

  it("stays unarchived when a close fails", async () => {
    const d = deps([pr("OPEN")], { closePullRequest: async () => { throw new Error("gh: forbidden"); } });
    await expect(archiveWorkspaceWithPrs("ws", { closeOpenPrs: true }, d)).rejects.toThrow("forbidden");
    expect(isWorkspaceArchived("ws")).toBe(false);
  });

  it("archives anyway when only the branch deletion fails, and says so", async () => {
    const d = deps([pr("OPEN")], { deleteBranch: async () => { throw new Error("protected"); } });
    const result = await archiveWorkspaceWithPrs("ws", { closeOpenPrs: true }, d);
    expect(isWorkspaceArchived("ws")).toBe(true);
    expect(result.warnings[0]).toContain("protected");
  });

  it("archives even when the harvest cannot start", async () => {
    const d = deps([], { startHarvest: () => { throw new Error("Too many concurrent operations"); } });
    const result = await archiveWorkspaceWithPrs("ws", {}, d);
    expect(isWorkspaceArchived("ws")).toBe(true);
    expect(result.harvest).toEqual({ error: "Too many concurrent operations" });
  });
});
