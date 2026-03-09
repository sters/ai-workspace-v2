import type { WorkspaceRepo } from "./workspace";

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

export interface PlannerInput extends RepoPromptInput {
  readmeContent: string;
  taskType: string;
  interactive?: boolean;
}

export interface CoordinatorInput {
  workspaceName: string;
  readmeContent: string;
  todoFiles: { repoName: string; content: string }[];
  workspacePath: string;
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
  reportPath: string;
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
}

export interface CreateTodoPlannerInput extends RepoPromptInput {
  readmeContent: string;
  reviewDir: string;
  taskType: string;
  instruction?: string;
}
