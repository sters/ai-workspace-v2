import { describe, it, expect } from "vitest";
import {
  parseConflictResolution,
  resolveBaseConflictsBudgetMs,
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

describe("resolveBaseConflictsBudgetMs", () => {
  it("scales with the number of repositories", () => {
    // The resolver children queue behind the group concurrency cap, so a flat
    // budget would kill the tail of a wide workspace mid-merge.
    expect(resolveBaseConflictsBudgetMs(4)).toBeGreaterThan(resolveBaseConflictsBudgetMs(1));
  });

  it("gives an empty workspace a usable budget rather than zero", () => {
    expect(resolveBaseConflictsBudgetMs(0)).toBeGreaterThan(0);
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
