import { describe, it, expect } from "vitest";
import {
  mergeBasePhaseBudgetMs,
  parseConflictResolution,
  pushMergePhaseBudgetMs,
  resolveConflictsPhaseBudgetMs,
  selectTargetPullRequests,
} from "@/lib/pipelines/resolve-base-conflicts";
import type { WorkspacePullRequest } from "@/types/pull-request";

function makePr(overrides: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    repoName: "widgets",
    repoPath: "github.com/acme/widgets",
    worktreePath: "/ws/task/github.com/acme/widgets",
    host: "github.com",
    owner: "acme",
    repo: "widgets",
    number: 42,
    url: "https://github.com/acme/widgets/pull/42",
    title: "Add widget cache",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/widget-cache",
    headSha: "1".repeat(40),
    baseRefName: "main",
    author: "someone",
    updatedAt: "2026-09-01T00:00:00Z",
    threads: [],
    checks: {
      checks: [],
      counts: {
        success: 0, failure: 0, running: 0, queued: 0, skipped: 0, cancelled: 0, unknown: 0,
      },
      reported: false,
    },
    ...overrides,
  };
}

describe("phase budgets", () => {
  const budgets = [
    ["merge", mergeBasePhaseBudgetMs],
    ["resolve", resolveConflictsPhaseBudgetMs],
    ["push", pushMergePhaseBudgetMs],
  ] as const;

  it.each(budgets)("the %s phase scales with the number of repositories", (_name, budget) => {
    // The resolver children queue behind the group concurrency cap and the git
    // commands run in series, so a flat budget would kill the tail of a wide
    // workspace mid-merge.
    expect(budget(4)).toBeGreaterThan(budget(1));
  });

  it.each(budgets)("the %s phase gives an empty workspace a usable budget", (_name, budget) => {
    expect(budget(0)).toBeGreaterThan(0);
  });

  it("gives the resolution the largest share, since it is the only model call", () => {
    expect(resolveConflictsPhaseBudgetMs(2)).toBeGreaterThan(mergeBasePhaseBudgetMs(2));
    expect(resolveConflictsPhaseBudgetMs(2)).toBeGreaterThan(pushMergePhaseBudgetMs(2));
  });
});

describe("selectTargetPullRequests", () => {
  it("skips pull requests that are not open", () => {
    // A merged or closed PR has no base to catch up with, and pushing to its
    // branch would touch history nobody is reviewing.
    const prs = [makePr(), makePr({ repoName: "api", state: "MERGED" })];
    expect(selectTargetPullRequests(prs).map((p) => p.repoName)).toEqual(["widgets"]);
  });

  it("narrows to one repository by worktree name or by full path", () => {
    const prs = [makePr(), makePr({ repoName: "api", repoPath: "github.com/acme/api" })];
    expect(selectTargetPullRequests(prs, "api").map((p) => p.repoName)).toEqual(["api"]);
    expect(
      selectTargetPullRequests(prs, "github.com/acme/widgets").map((p) => p.repoName),
    ).toEqual(["widgets"]);
  });

  it("returns nothing when the named repository has no open pull request", () => {
    expect(selectTargetPullRequests([makePr()], "other")).toEqual([]);
  });
});

describe("parseConflictResolution", () => {
  it("reads the child's structured report", () => {
    const raw = JSON.stringify({
      resolvedFiles: [
        { path: "src/cache.ts", side: "both", note: "Kept the base's rename and this branch's TTL." },
        { path: "", side: "ours", note: "dropped — no path" },
      ],
      unresolvedFiles: [{ path: "bun.lock", question: "Run `bun install` to regenerate." }],
      summary: "The base renamed the cache module.",
    });

    expect(parseConflictResolution(raw)).toEqual({
      resolvedFiles: [
        { path: "src/cache.ts", side: "both", note: "Kept the base's rename and this branch's TTL." },
      ],
      unresolvedFiles: [{ path: "bun.lock", question: "Run `bun install` to regenerate." }],
      summary: "The base renamed the cache module.",
    });
  });

  it("returns null on unreadable output, which costs the log its explanation only", () => {
    // What gets committed is decided by reading git, not by this report.
    expect(parseConflictResolution("")).toBeNull();
    expect(parseConflictResolution("I resolved the conflicts.")).toBeNull();
    expect(parseConflictResolution("null")).toBeNull();
  });

  it("tolerates missing arrays rather than throwing", () => {
    expect(parseConflictResolution(JSON.stringify({ summary: "done" }))).toEqual({
      resolvedFiles: [],
      unresolvedFiles: [],
      summary: "done",
    });
  });
});
