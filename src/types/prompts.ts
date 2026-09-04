import type { PrReviewThread } from "./pull-request";
import type { AnchoredReviewFinding } from "./review-findings";
import type { WorkspaceRepo } from "./workspace";

export type InteractionLevel = "low" | "mid" | "high";

/**
 * Base for prompt inputs that target a specific repo within a workspace.
 * Combines workspace identity with the repo location fields from WorkspaceRepo.
 */
export interface RepoPromptInput extends WorkspaceRepo {
  workspaceName: string;
}

export interface ExecutorInput extends RepoPromptInput {
  readmeContent: string;
  todoContent: string;
  workspacePath: string;
}

export interface BatchedExecutorInput extends ExecutorInput {
  batchIndex: number;
  totalBatches: number;
  /** Markdown of the current batch's TODO items only. */
  batchTodoContent: string;
  /** Summary of previously completed items (if any). */
  completedSummary?: string;
}

export interface PlannerInput extends RepoPromptInput {
  readmeContent: string;
  taskType: string;
  interactive?: boolean;
  /** Override directory for TODO file output. When set, uses this absolute path instead of the default relative path. */
  todoOutputDir?: string;
  /** Optional free-text instruction from the user to focus/guide TODO planning. */
  instruction?: string;
}

export interface CoordinatorInput {
  workspaceName: string;
  readmeContent: string;
  todoFiles: { repoName: string; content: string }[];
  workspacePath: string;
  repoWorktrees?: { repoName: string; worktreePath: string }[];
}

export interface ReviewerInput {
  workspaceName: string;
  repoName: string;
  readmeContent: string;
  todoContent: string;
  worktreePath: string;
}

/** One finding from the pre-execution plan review (`TODO_REVIEW_SCHEMA`). */
export interface TodoReviewFinding {
  /**
   * `risk`: the item as written introduces a defect. `blocking`: it cannot be
   * executed as written. `unclear`: executable on an assumption worth recording.
   */
  kind: "risk" | "blocking" | "unclear";
  /** The TODO item the finding is about, quoted closely enough to locate it. */
  item: string;
  /** The defect (for `risk`) or the specific question (for the others). */
  detail: string;
  suggestedResolution?: string;
}

/**
 * One repository's own work since a prior review. Absent on a consumer means no
 * usable baseline, and the whole branch is that repository's review target.
 *
 * Shared by the per-repo code reviewer and the cross-repository reviewer so both
 * narrow against the same range — the cross-repo reviewer was the only exempt one,
 * and re-reading an unchanged boundary every cycle is what it cost.
 */
export interface ReviewScope {
  /** Review session the baseline came from, named so the reviewer can cite it. */
  sinceTimestamp: string;
  sinceSha: string;
  changedFiles: string;
  diffStat: string;
  commitLog: string;
  hasChanges: boolean;
}

export interface CodeReviewerInput extends RepoPromptInput {
  baseBranch: string;
  reviewTimestamp: string;
  readmeContent: string;
  repoChanges: string;
  reviewFilePath: string;
  /**
   * Where to write the machine-readable copy of the findings, which is what the
   * review tab offers for posting on the PR as inline comments. Absent omits the
   * second deliverable entirely.
   */
  findingsFilePath?: string;
  /** Raw `artifacts/known-findings.md` content, or "" / undefined when absent. */
  knownFindings?: string;
  /**
   * Narrows the review to the branch's own work since a prior review. Absent
   * means no usable baseline, and the whole branch is the review target.
   */
  reviewScope?: ReviewScope;
}

/**
 * Finding-grounder input — checks one of *our* review findings before it becomes
 * a comment on a PR. The outbound mirror of `PrCommentValidatorInput`.
 */
export interface FindingGrounderInput {
  workspaceName: string;
  repoName: string;
  repoPath: string;
  worktreePath: string;
  baseBranch: string;
  prUrl: string;
  prTitle?: string;
  finding: AnchoredReviewFinding;
  /** Existing review comments on the PR, as the sample of its conventions. */
  conventionSamples?: { author: string; body: string }[];
}

/** Requested-fix verifier input — checks a previous cycle's asks against the code. */
export interface FixVerifierInput extends RepoPromptInput {
  baseBranch: string;
  reviewTimestamp: string;
  /** The previous cycle's gate `fixableIssues`, verbatim. */
  requestedFixes: string[];
  /**
   * Where the asks came from. `pr-comments` are review comments already on the
   * PR, so the author is the one who acts on them and a declined ask is
   * recorded in the thread rather than in a TODO file. Defaults to `gate`.
   */
  askSource?: "gate" | "pr-comments";
  verifyFilePath: string;
  /** Baseline the fixes were requested at, when one was recorded. */
  sinceSha?: string;
  sinceTimestamp?: string;
}

/**
 * PR review-comment validator input — one thread per call.
 *
 * One call per thread rather than one per PR: each verdict has to rest on its own
 * evidence, and a single call covering ten comments treats the tenth as an
 * afterthought. The threads are independent, so they also run concurrently.
 */
export interface PrCommentValidatorInput extends RepoPromptInput {
  baseBranch: string;
  prUrl: string;
  prTitle?: string;
  thread: PrReviewThread;
}

/** Cross-repository code-review agent input (multi-repo workspaces only). */
export interface CrossRepositoryReviewerInput {
  workspaceName: string;
  reviewTimestamp: string;
  readmeContent: string;
  reviewFilePath: string;
  /** Raw `artifacts/known-findings.md` content, or "" / undefined when absent. */
  knownFindings?: string;
  repos: {
    repoName: string;
    repoPath: string;
    baseBranch: string;
    worktreePath: string;
    repoChanges: string;
    /**
     * This repository's own work since the previous review. Absent means no usable
     * baseline for it, and its whole branch is in scope. A boundary is new work
     * when *either* side has a scope naming it — see `buildCrossRepositoryReviewerPrompt`.
     */
    reviewScope?: ReviewScope;
  }[];
}

export interface TodoVerifierInput extends RepoPromptInput {
  baseBranch: string;
  reviewTimestamp: string;
  todoContent: string;
  verifyFilePath: string;
}

export interface ReadmeVerifierInput extends RepoPromptInput {
  baseBranch: string;
  reviewTimestamp: string;
  readmeContent: string;
  repoChanges: string;
  verifyFilePath: string;
  /** Pre-rendered Acceptance Criteria checklist parsed from the README, or "" when absent. */
  acceptanceCriteria?: string;
  /**
   * Report the Verify constraints phase wrote before this child started. Present
   * so a criterion phrased as "the declared commands exit 0" is answered by
   * reading it rather than by re-running lint/test/build.
   */
  constraintReportPath?: string;
}

export interface PRCreatorInput extends RepoPromptInput {
  baseBranch: string;
  readmeContent: string;
  repoChanges: string;
  draft: boolean;
  prTemplate?: string;
  existingPR?: {
    url: string;
    title: string;
    body: string;
  };
  /**
   * Title every repo of this workspace must use verbatim, from the README's
   * `# Task:` heading. Only set for a new PR: the update path leaves an existing
   * title alone, and an unfilled heading (`TBD`) is worse than a composed title.
   */
  sharedTitle?: string;
  /** Body of the TODO file's `## PR Review Threads` section, when it has one. */
  prReviewThreads?: string;
  /** Absolute TODO file path — only set alongside `prReviewThreads`, which is what needs it. */
  todoFilePath?: string;
}

export interface ResearcherInput {
  workspaceName: string;
  readmeContent: string;
  repos: WorkspaceRepo[];
  workspacePath: string;
  reportDir: string;
}

/** Per-repo findings agent input. */
export interface ResearchFindingsRepoInput {
  workspaceName: string;
  readmeContent: string;
  repo: WorkspaceRepo;
  workspacePath: string;
  reportDir: string;
}

/** Per-repo recommendations & next-steps agent input. */
export interface ResearchRecommendationsRepoInput {
  workspaceName: string;
  readmeContent: string;
  repo: WorkspaceRepo;
  workspacePath: string;
  reportDir: string;
  /** Content of findings-{repoName}.md */
  findingsContent: string;
  /** Content of findings-cross-repository.md */
  crossRepoFindingsContent: string;
}

/** Cross-repo recommendations & next-steps agent input. */
export interface ResearchRecommendationsCrossInput {
  workspaceName: string;
  readmeContent: string;
  repos: WorkspaceRepo[];
  workspacePath: string;
  reportDir: string;
  allFindings: { name: string; content: string }[];
}

/** Integration / summary agent input. */
export interface ResearchIntegrationInput {
  workspaceName: string;
  readmeContent: string;
  workspacePath: string;
  reportDir: string;
  allFiles: { name: string; content: string }[];
}

export interface ReadmeUpdaterInput {
  workspaceName: string;
  readmeContent: string;
  workspacePath: string;
  instruction: string;
  interactive?: boolean;
  interject?: boolean;
}

export interface UpdaterInput {
  workspaceName: string;
  repoName: string;
  readmeContent: string;
  todoContent: string;
  worktreePath: string;
  workspacePath: string;
  instruction: string;
  interactive?: boolean;
  interject?: boolean;
}

export interface CollectorInput {
  workspaceName: string;
  reviewTimestamp: string;
  reviewDir: string;
  reviewFiles: string[];
  verifyFiles: string[];
  readmeVerifyFiles: string[];
  constraintFiles: string[];
  /**
   * `VERIFY-FIXES-*` reports. Present only on a cycle whose predecessor asked
   * for fixes, so absent on a first review.
   */
  fixVerifyFiles?: string[];
}

export interface InitAnalyzeAndReadmeInput {
  description: string;
  readmeTemplate: string;
  interactionLevel?: InteractionLevel;
}

export interface CreateTodoPlannerInput extends RepoPromptInput {
  readmeContent: string;
  reviewDir: string;
  taskType: string;
  instruction?: string;
}

export interface BestOfNReviewerInput {
  workspaceName: string;
  operationType: string;
  candidates: { label: string; diff: string; resultText?: string }[];
  readmeContent: string;
}

export interface BestOfNFileReviewerInput {
  operationType: string;
  candidates: { label: string; files: { name: string; content: string }[] }[];
}

export interface AutonomousGateInput {
  workspaceName: string;
  reviewSummary: string;
  reviewFiles: { name: string; content: string }[];
  todoFiles: { repoName: string; content: string }[];
  readmeContent: string;
  /** Pre-rendered Acceptance Criteria checklist parsed from the README, or "" when absent. */
  acceptanceCriteria?: string;
  loopIteration: number;
  maxLoops: number;
  previousGateResults?: { cycle: number; reason: string; fixableIssues: string[] }[];
  /** Raw `artifacts/known-findings.md` content, or "" / undefined when absent. */
  knownFindings?: string;
}

export interface ReadmeClarityGateInput {
  workspaceName: string;
  readmeContent: string;
  /** Pre-rendered Acceptance Criteria checklist parsed from the README, or "" when absent. */
  acceptanceCriteria?: string;
}

export interface CriteriaFeasibilityInput {
  workspaceName: string;
  readmeContent: string;
  /** Pre-rendered Acceptance Criteria checklist parsed from the README, or "" when absent. */
  acceptanceCriteria?: string;
  /** Every repository worktree, since a criterion's blocker usually sits on the other side. */
  repos: { repoName: string; worktreePath: string }[];
}

export interface WorkspaceSuggesterInput {
  workspaceName: string;
  readmeContent: string;
  /**
   * Digest of the parent operation's execution transcript (assistant text,
   * thinking, tool-call summaries). Used to surface incidental out-of-scope
   * observations Claude made mid-work rather than final TODO/review output.
   */
  operationDigest: string;
}

export interface DiscoveryInput {
  /** The workspace being analyzed. */
  workspace: {
    name: string;
    title: string;
    taskType: string;
    progress: number;
    repositories: string[];
    readmeContent: string;
    todos: { repoName: string; completed: number; pending: number; blocked: number; total: number }[];
  };
  /** Operations that ran against this workspace. */
  operations: {
    type: string;
    completedAt: string;
    inputs: Record<string, unknown>;
    resultSummary: string;
  }[];
  /** Names of all other existing workspaces (for deduplication). */
  otherWorkspaceNames: string[];
}

export interface SuggestionPrunerInput {
  repoPath: string;
  suggestions: {
    id: string;
    title: string;
    description: string;
  }[];
}

export interface SuggestionAggregatorInput {
  suggestions: {
    id: string;
    targetRepository: string;
    title: string;
    description: string;
  }[];
}

export interface BestOfNFileSynthesizerInput {
  operationType: string;
  candidates: { label: string; files: { name: string; content: string }[] }[];
  /** Base candidate index (1-indexed) to start from. */
  baseCandidate: number;
  /** Source candidates (1-indexed) to draw from. */
  sources: number[];
  /** Directory where synthesized files should be written. */
  outputDir: string;
  /** File names to synthesize. */
  fileNames: string[];
}
