/**
 * Whether a workspace's reviews still describe its pull requests.
 *
 * `worktreeStale` is separate from `updatedSinceReview` because they lead to
 * different actions: a PR that moved calls for a re-review, while a worktree
 * behind the PR head is what would make that re-review read the wrong code.
 */

export interface RepoReviewFreshness {
  repoName: string;
  /** HEAD the last review judged, or null when the repo has never been reviewed. */
  lastReviewedSha: string | null;
  /** Session that recorded it (`YYYYMMDD-HHMMSS`), or null. */
  lastReviewedAt: string | null;
  /** The worktree's HEAD now. */
  localHead: string | null;
  prUrl: string | null;
  prHeadSha: string | null;
  /** The PR's head is not the commit the last review judged. */
  updatedSinceReview: boolean;
  /** The worktree is not at the PR's head, so a review now would read something else. */
  worktreeStale: boolean;
}

export interface ReviewFreshnessResult {
  repos: RepoReviewFreshness[];
  /** Any repository whose PR has moved since it was last reviewed. */
  anyUpdatedSinceReview: boolean;
}
