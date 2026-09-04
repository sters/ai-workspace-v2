import { describe, it, expect } from "vitest";
import { computeRepoFreshness } from "@/lib/workspace/review-freshness";

const REVIEWED = "1111111111111111111111111111111111111111";
const PUSHED = "2222222222222222222222222222222222222222";

function freshness(overrides: Partial<Parameters<typeof computeRepoFreshness>[0]> = {}) {
  return computeRepoFreshness({
    repoName: "svc",
    localHead: REVIEWED,
    lastReviewedSha: REVIEWED,
    lastReviewedAt: "20260901-120000",
    pr: { url: "https://github.com/acme/svc/pull/7", headSha: REVIEWED },
    ...overrides,
  });
}

describe("computeRepoFreshness", () => {
  it("reports nothing to do when the PR head is what was reviewed", () => {
    const result = freshness();
    expect(result.updatedSinceReview).toBe(false);
    expect(result.worktreeStale).toBe(false);
  });

  it("flags a PR that moved since the last review", () => {
    const result = freshness({ pr: { url: "u", headSha: PUSHED } });
    expect(result.updatedSinceReview).toBe(true);
    // The worktree is still where the review left it, which is exactly what the
    // refresh phase has to fix before the re-review reads anything.
    expect(result.worktreeStale).toBe(true);
  });

  it("separates a refreshed-but-unreviewed worktree from a stale one", () => {
    const result = freshness({ localHead: PUSHED, pr: { url: "u", headSha: PUSHED } });
    expect(result.updatedSinceReview).toBe(true);
    expect(result.worktreeStale).toBe(false);
  });

  it("says nothing when the repo has no PR", () => {
    const result = freshness({ pr: null });
    expect(result.updatedSinceReview).toBe(false);
    expect(result.worktreeStale).toBe(false);
    expect(result.prHeadSha).toBeNull();
  });

  it("says nothing when the repo has never been reviewed", () => {
    const result = freshness({
      lastReviewedSha: null,
      lastReviewedAt: null,
      pr: { url: "u", headSha: PUSHED },
    });
    expect(result.updatedSinceReview).toBe(false);
    // The worktree comparison still holds: it is behind the PR either way.
    expect(result.worktreeStale).toBe(true);
  });

  it("treats an empty PR head sha as absent rather than as a difference", () => {
    const result = freshness({ pr: { url: "u", headSha: "" } });
    expect(result.prHeadSha).toBeNull();
    expect(result.updatedSinceReview).toBe(false);
    expect(result.worktreeStale).toBe(false);
  });

  it("says nothing when the worktree HEAD could not be read", () => {
    const result = freshness({ localHead: null, pr: { url: "u", headSha: PUSHED } });
    expect(result.worktreeStale).toBe(false);
    expect(result.updatedSinceReview).toBe(true);
  });
});
