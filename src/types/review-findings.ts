/**
 * Structured review findings — the machine-readable half of a code review,
 * written so a human can tick the ones worth posting on the PR as inline
 * comments.
 *
 * The markdown report stays the deliverable everything else reads (the
 * collector, the autonomous gate). This exists because a checkbox needs a
 * discrete object with a stable id, and a report's prose bullets have neither.
 */

export type FindingSeverity = "critical" | "warning" | "suggestion";

export type FindingConfidence = "high" | "medium" | "low";

/**
 * Where a finding can be attached on the PR.
 *
 * GitHub rejects an inline comment whose line falls outside a diff hunk, so this
 * is resolved against the diff **before** the human picks, not at post time —
 * otherwise a selection of six comes back as four successes and two 422s.
 */
export type FindingAnchor = "inline" | "file" | "pr-body";

/** One finding as the reviewer wrote it. */
export interface ReviewFinding {
  /** Stable across re-reads of the same review: hash of repo + path + line + body. */
  id: string;
  repoName: string;
  /** Repository-relative path, as it appears in the diff. */
  path: string;
  /** Line in the file the finding is about, or null when it is file-wide. */
  line: number | null;
  /** Start of a multi-line range, when the reviewer gave one. */
  startLine: number | null;
  /** RIGHT is the post-change file; LEFT is for a finding about removed code. */
  side: "RIGHT" | "LEFT";
  severity: FindingSeverity;
  confidence: FindingConfidence;
  /** One line, used as the row label. */
  title: string;
  /** The comment body, written for a PR reader rather than for the report. */
  body: string;
  /** Replacement code for a ```suggestion block, when the fix is a small edit. */
  suggestion: string | null;
}

/** A finding plus everything the UI needs to decide whether to offer it. */
export interface AnchoredReviewFinding extends ReviewFinding {
  anchor: FindingAnchor;
  /** Why it is not `inline`. Null when it is. */
  anchorReason: string | null;
  /** Already on the PR — either in a submitted review or in a pending one. */
  posted: boolean;
}

/**
 * Whether a finding's claim survives being checked against the pushed code.
 *
 * `unclear` is not posted: the finding is going onto someone else's PR, and a
 * claim the code could not settle is not one to assert there unprompted.
 */
export type GroundingVerdict = "yes" | "no" | "unclear";

/**
 * Whose problem it is, once the claim holds.
 *
 * Only `pr` earns a comment. `local-only` is the case this exists for — a finding
 * that reproduces from uncommitted or stale local state and is not in the branch
 * anyone else can see.
 */
export type GroundingScope = "pr" | "local-only" | "pre-existing";

/** One finding's grounding verdict, and the comment it earned if it did. */
export interface FindingGrounding {
  findingId: string;
  repoName: string;
  holds: GroundingVerdict;
  scope: GroundingScope;
  /** `file:line` references the verdict rests on. */
  evidence: string[];
  /** The comment as rewritten for this repository, empty when none was earned. */
  comment: string;
  /** Why it was not posted, or how the claim was confirmed. */
  reason: string;
  /** Whether this grounding's comment actually went out. */
  posted: boolean;
  groundedAt: string;
}

export interface FindingGroundingStore {
  version: 1;
  /** Keyed by finding id. */
  groundings: Record<string, FindingGrounding>;
}

/** The PR a repository's findings would be posted to. */
export interface FindingsTargetPr {
  repoName: string;
  url: string;
  number: number;
  host: string;
  owner: string;
  repo: string;
  baseRefName: string;
  /** PR head SHA. Comments are anchored to it. */
  headSha: string;
  /**
   * Set when the worktree is not at the PR head, i.e. the diff the anchors were
   * resolved against is not the diff GitHub will apply them to.
   */
  staleWorktree: boolean;
  /**
   * GitHub allows one pending review per user per PR, so a leftover one blocks
   * posting until it is submitted or discarded.
   */
  hasPendingReview: boolean;
}

/** Per-repository findings for one review session. */
export interface RepoReviewFindings {
  repoName: string;
  findings: AnchoredReviewFinding[];
  /** The PR to post to, or null when the branch has none. */
  pr: FindingsTargetPr | null;
  /** Why this repository has no findings or no PR. Null when all is well. */
  problem: string | null;
}

export interface ReviewFindingsResult {
  timestamp: string;
  repos: RepoReviewFindings[];
  /**
   * What a previous post decided about each finding, by finding id. Carried back
   * so a later visit shows which findings were dropped and why, instead of
   * offering them again as if nothing had happened.
   */
  groundings: Record<string, FindingGrounding>;
}

/** One finding's fate in a post request. */
export interface PostedFindingResult {
  id: string;
  status: "posted" | "skipped" | "failed";
  /** Present for skipped/failed. */
  reason?: string;
}

export interface PostCommentsResult {
  /** The review GitHub created, when anything was posted. */
  reviewUrl: string | null;
  /** True when the review was left pending for a human to submit. */
  pending: boolean;
  results: PostedFindingResult[];
}

/**
 * One post request's outcome. A selection can span repositories and each gets its
 * own review, so a partial failure is reported per repository rather than
 * collapsing the whole request.
 */
export interface PostCommentsResponse {
  reviews: {
    repoName: string;
    reviewUrl: string | null;
    pending: boolean;
    problem: string | null;
  }[];
  results: PostedFindingResult[];
}
