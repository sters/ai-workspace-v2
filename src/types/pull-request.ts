/**
 * The PR-integration model behind the workspace's Pull Requests tab.
 *
 * Scoped to the PR on each worktree's own branch — the same PR
 * `checkExistingPR` looks for — not to every open PR in the repository. The tab
 * is a view of this workspace's work, so a PR nobody in the workspace created
 * has no thread here that a triage could act on.
 */

/** Where a review thread stands after a human looked at it in the tab. */
export type PrThreadVerdict = "valid" | "invalid" | "unclear";

export interface PrReviewComment {
  /** Permalink to the individual comment (`...#discussion_r123`). */
  url: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface PrReviewThread {
  /**
   * GraphQL node id (`PRRT_…`), not the comment's numeric id. This is the key
   * everything downstream joins on: the validation store, the `## PR Review
   * Threads` rows a triage writes, and the reply/resolve call `create-pr` makes.
   */
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  /** File the thread is anchored to, or null for a thread on no longer existing lines. */
  path: string | null;
  line: number | null;
  comments: PrReviewComment[];
}

/**
 * Normalized CI state, collapsing GitHub's two unrelated vocabularies — a
 * CheckRun's `status` + `conclusion`, and a legacy StatusContext's single
 * `state` — into one set.
 *
 * `queued` and `running` stay **separate** because they answer different
 * questions for someone deciding whether to wait: a queued run has not started,
 * so it has no logs yet and nothing about its outcome is knowable, while a
 * running one is producing output now. Likewise `skipped` / `cancelled` /
 * `unknown` are their own states rather than being folded into pass or fail —
 * each is a thing GitHub actually said, and guessing which side it falls on is
 * how a summary ends up claiming a PR is green.
 */
export type PrCheckState =
  | "success"
  | "failure"
  | "running"
  | "queued"
  | "skipped"
  | "cancelled"
  | "unknown";

export interface PrCheck {
  name: string;
  state: PrCheckState;
  /** Link to the run's logs, when GitHub gives one. */
  url: string | null;
}

export interface PrChecksSummary {
  /** Per-check detail, failures first, then running, then queued. */
  checks: PrCheck[];
  /**
   * One count per state. Complete rather than a chosen subset, so adding a state
   * cannot leave a bucket of checks uncounted anywhere that reads this.
   */
  counts: Record<PrCheckState, number>;
  /**
   * Whether GitHub reported any checks at all. `false` means the PR has no CI
   * configured, which is not the same as everything passing.
   */
  reported: boolean;
}

export interface WorkspacePullRequest {
  /** Workspace repo alias, e.g. `my-service`. */
  repoName: string;
  /** e.g. `github.com/org/my-service`. */
  repoPath: string;
  worktreePath: string;
  /** Host the PR lives on — `github.com`, or an enterprise host. */
  host: string;
  owner: string;
  /** Repository name as GitHub knows it, which can differ from `repoName`. */
  repo: string;
  number: number;
  url: string;
  title: string;
  /** OPEN / CLOSED / MERGED. */
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  author: string;
  updatedAt: string;
  threads: PrReviewThread[];
  /** CI on the PR's head commit, read in the same round trip as the threads. */
  checks: PrChecksSummary;
}

/**
 * A repo that produced no PR, kept rather than dropped: "this repo has no PR
 * yet" and "`gh` failed" are different situations and the tab should say which.
 */
export interface PullRequestProblem {
  repoName: string;
  reason: string;
}

/**
 * One human's judgment on one review thread, produced by the validate
 * operation. Persisted so the verdict survives a page reload and can be fed
 * into a later triage — the validate → triage route.
 */
export interface PrThreadValidation {
  threadId: string;
  repoName: string;
  /** Permalink of the thread's first comment, for display without the PR list. */
  commentUrl: string;
  verdict: PrThreadVerdict;
  /** What the reviewer is asking for, restated plainly. */
  interpretation: string;
  /** Why the ask holds or does not hold against the code as it stands. */
  reasoning: string;
  /** What to do about it — or why nothing needs doing. */
  recommendation: string;
  /** `file:line` references the verdict rests on. */
  evidence: string[];
  validatedAt: string;
}

/** `artifacts/pr-validations.json`, keyed by thread node id. */
export interface PrValidationStore {
  version: 1;
  validations: Record<string, PrThreadValidation>;
}

export interface WorkspacePullRequestsResult {
  pullRequests: WorkspacePullRequest[];
  problems: PullRequestProblem[];
  validations: Record<string, PrThreadValidation>;
}
