// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { getPrSnapshot, listPrEvents, savePrObservation } from "@/lib/db/pr-watch";
import type { WorkspacePullRequest, RepoPullRequestRead } from "@/types/pull-request";

import { observeRepoPr } from "@/lib/pr-watcher";
const repo = { repoPath: "github.com/acme/widgets", repoName: "widgets", worktreePath: "/ws/widgets" };
const watchWorkspacePrs = (ws: string, read: Parameters<typeof observeRepoPr>[2]) => observeRepoPr(ws, repo, read);

function pr(overrides: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    repoName: "widgets", repoPath: "github.com/acme/widgets", worktreePath: "/ws/widgets",
    host: "github.com", owner: "acme", repo: "widgets", number: 7,
    url: "https://github.com/acme/widgets/pull/7", title: "t", state: "OPEN", isDraft: false,
    headRefName: "feat", headSha: "aaa", baseRefName: "main", author: "me", updatedAt: "",
    mergeable: "MERGEABLE", threads: [],
    checks: { checks: [], counts: { success: 1, failure: 0, running: 0, queued: 0, skipped: 0, cancelled: 0, unknown: 0 }, reported: true },
    ...overrides,
  };
}

describe("observeRepoPr", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("records a transition across two cycles", async () => {
    await watchWorkspacePrs("ws", async () => ({ pr: pr() }));
    await watchWorkspacePrs("ws", async () => ({ pr: pr({ state: "MERGED" }) }));
    expect(listPrEvents("ws").map((e) => e.kind)).toEqual(["merged"]);
    expect(getPrSnapshot("ws", "widgets")?.state).toBe("MERGED");
  });

  it("stops reading a PR once it is merged or closed", async () => {
    savePrObservation(
      { workspace: "ws", repoName: "widgets", prUrl: pr().url, state: "CLOSED", headSha: "aaa", ci: "passing", mergeable: "MERGEABLE", seenComments: [] },
      [],
    );
    const read = vi.fn(async (): Promise<RepoPullRequestRead> => ({ pr: pr() }));
    await watchWorkspacePrs("ws", read);
    expect(read).not.toHaveBeenCalled();
  });

  it("skips a read whose threads and CI could not be fetched", async () => {
    await watchWorkspacePrs("ws", async () => ({ pr: pr() }));
    await watchWorkspacePrs("ws", async () => ({
      pr: pr({ checks: { checks: [], counts: pr().checks.counts, reported: false } }),
      problem: { repoName: "widgets", reason: "graphql failed" },
    }));
    await watchWorkspacePrs("ws", async () => ({ pr: pr() }));
    expect(listPrEvents("ws")).toEqual([]);
  });
});
