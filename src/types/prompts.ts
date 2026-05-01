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

export interface CodeReviewerInput extends RepoPromptInput {
  baseBranch: string;
  reviewTimestamp: string;
  readmeContent: string;
  repoChanges: string;
  reviewFilePath: string;
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

export interface UpdaterInput {
  workspaceName: string;
  repoName: string;
  readmeContent: string;
  todoContent: string;
  worktreePath: string;
  workspacePath: string;
  instruction: string;
  interactive?: boolean;
}

export interface CollectorInput {
  workspaceName: string;
  reviewTimestamp: string;
  reviewDir: string;
  reviewFiles: string[];
  verifyFiles: string[];
  readmeVerifyFiles: string[];
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
  loopIteration: number;
  maxLoops: number;
  previousGateResults?: { cycle: number; reason: string; fixableIssues: string[] }[];
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
