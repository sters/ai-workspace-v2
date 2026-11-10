// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { listPrEvents } from "@/lib/db/pr-watch";
import { createWatchScheduler, type Notification, type SchedulerDeps } from "@/lib/pr-watcher/scheduler";
import type { WorkspacePullRequest, RepoPullRequestRead } from "@/types/pull-request";
import type { WorkspaceRepo } from "@/types/workspace";

const MIN = 60_000;
const SWEEP = 15 * MIN;

const widgets: WorkspaceRepo = { repoPath: "github.com/acme/widgets", repoName: "widgets", worktreePath: "/ws/widgets" };
const gadgets: WorkspaceRepo = { repoPath: "github.com/acme/gadgets", repoName: "gadgets", worktreePath: "/ws/gadgets" };

const counts = { success: 1, failure: 0, running: 0, queued: 0, skipped: 0, cancelled: 0, unknown: 0 };

function pr(repo: WorkspaceRepo, number: number, overrides: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    repoName: repo.repoName, repoPath: repo.repoPath, worktreePath: repo.worktreePath,
    host: "github.com", owner: "acme", repo: repo.repoName, number,
    url: `https://github.com/acme/${repo.repoName}/pull/${number}`, title: "t", state: "OPEN", isDraft: false,
    headRefName: "feat", headSha: "aaa", baseRefName: "main", author: "me", updatedAt: "",
    mergeable: "MERGEABLE", threads: [],
    checks: { checks: [], counts, reported: true },
    ...overrides,
  };
}

const pending = { checks: [], counts: { ...counts, success: 0, running: 1 }, reported: true };
const failing = {
  checks: [{ name: "test", state: "failure" as const, url: null }],
  counts: { ...counts, success: 0, failure: 1 },
  reported: true,
};

function setup(prs: Record<string, WorkspacePullRequest | null>) {
  let notifications: Notification[] = [];
  const shas: Record<string, string> = {};
  const read = vi.fn(async (repo: WorkspaceRepo): Promise<RepoPullRequestRead> => {
    const p = prs[repo.repoName];
    return p ? { pr: p } : { problem: { repoName: repo.repoName, reason: "no pull requests found" } };
  });
  const deps: SchedulerDeps = {
    listTargets: async () => [{ workspace: "ws", repo: widgets }, { workspace: "ws", repo: gadgets }],
    read,
    notified: async () => {
      const n = notifications;
      notifications = [];
      return n;
    },
    baseSha: async (worktreePath, base) => shas[`${worktreePath}:${base}`] ?? null,
  };
  const scheduler = createWatchScheduler(deps, SWEEP);
  const readNames = () => read.mock.calls.map(([r]) => r.repoName);
  return {
    scheduler,
    read,
    readNames,
    notify: (n: Notification[]) => { notifications = n; },
    setSha: (key: string, sha: string) => { shas[key] = sha; },
    /** Tick and report which repos were read in that tick. */
    tickReads: async (now: number) => {
      read.mockClear();
      await scheduler.tick(now);
      return readNames().sort();
    },
  };
}

describe("watch scheduler", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("reads every repository on a sweep and nothing between sweeps without a signal", async () => {
    const s = setup({ widgets: pr(widgets, 1), gadgets: pr(gadgets, 2) });
    expect(await s.tickReads(0)).toEqual(["gadgets", "widgets"]);
    expect(await s.tickReads(1 * MIN)).toEqual([]);
    expect(await s.tickReads(SWEEP)).toEqual(["gadgets", "widgets"]);
  });

  it("reads only the PR a notification names", async () => {
    const s = setup({ widgets: pr(widgets, 1), gadgets: pr(gadgets, 2) });
    await s.tickReads(0);
    s.notify([{ repo: "acme/widgets", pr: 1 }]);
    expect(await s.tickReads(1 * MIN)).toEqual(["widgets"]);
  });

  it("ignores a notification on another PR of the same repository", async () => {
    const s = setup({ widgets: pr(widgets, 1), gadgets: pr(gadgets, 2) });
    await s.tickReads(0);
    s.notify([{ repo: "acme/widgets", pr: 99 }]);
    expect(await s.tickReads(1 * MIN)).toEqual([]);
  });

  it("reads a repository's PRs on a CI notification, which names no PR", async () => {
    const s = setup({ widgets: pr(widgets, 1), gadgets: pr(gadgets, 2) });
    await s.tickReads(0);
    s.notify([{ repo: "acme/gadgets", pr: null }]);
    expect(await s.tickReads(1 * MIN)).toEqual(["gadgets"]);
  });

  it("reads a branch with no PR yet when a PR notification arrives for its repository", async () => {
    const s = setup({ widgets: null, gadgets: pr(gadgets, 2) });
    await s.tickReads(0);
    s.notify([{ repo: "Acme/Widgets", pr: 5 }]);
    expect(await s.tickReads(1 * MIN)).toEqual(["widgets"]);
  });

  it("re-reads PRs on a base branch once that branch moves", async () => {
    const s = setup({ widgets: pr(widgets, 1), gadgets: pr(gadgets, 2) });
    s.setSha("/ws/widgets:main", "b1");
    s.setSha("/ws/gadgets:main", "c1");
    await s.tickReads(0);
    expect(await s.tickReads(1 * MIN)).toEqual([]);
    s.setSha("/ws/widgets:main", "b2");
    expect(await s.tickReads(2 * MIN)).toEqual(["widgets"]);
  });

  it("backs off while CI is pending and records the failure when it lands", async () => {
    const prs: Record<string, WorkspacePullRequest | null> = { widgets: pr(widgets, 1, { checks: pending }), gadgets: null };
    const s = setup(prs);
    const widgetsReadsAt = async (minutes: number[]) => {
      const hits: number[] = [];
      for (const m of minutes) if ((await s.tickReads(m * MIN)).includes("widgets")) hits.push(m);
      return hits;
    };
    await s.tickReads(0);
    // 1, then +2, then +4: reads at 1, 3, 7.
    expect(await widgetsReadsAt([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 3, 7]);

    prs.widgets = pr(widgets, 1, { checks: failing });
    expect(await widgetsReadsAt([8, 9, 10, 11, 12, 13, 14, 15])).toEqual([15]);
    expect(listPrEvents("ws").map((e) => e.kind)).toEqual(["ci-failing"]);
    // Settled: no more backoff reads before the next sweep.
    expect(await widgetsReadsAt([16, 17, 18, 20, 25])).toEqual([]);
  });

  it("caps the backoff interval", async () => {
    const s = setup({ widgets: pr(widgets, 1, { checks: pending }), gadgets: null });
    await s.tickReads(0);
    const hits: number[] = [];
    for (let m = 1; m < 2 * SWEEP / MIN; m++) if ((await s.tickReads(m * MIN)).includes("widgets")) hits.push(m);
    // 15 is also the sweep; after it the gap stays 8 rather than doubling to 16.
    expect(hits).toEqual([1, 3, 7, 15, 23]);
  });

  it("keeps rechecking while GitHub is still computing mergeability", async () => {
    const prs: Record<string, WorkspacePullRequest | null> = { widgets: pr(widgets, 1, { mergeable: "UNKNOWN" }), gadgets: null };
    const s = setup(prs);
    await s.tickReads(0);
    expect(await s.tickReads(1 * MIN)).toEqual(["widgets"]);
  });
});
