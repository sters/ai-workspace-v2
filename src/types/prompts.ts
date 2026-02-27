export interface ExecutorInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  readmeContent: string;
  todoContent: string;
  worktreePath: string;
}

export interface PlannerInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  readmeContent: string;
  worktreePath: string;
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

export interface CodeReviewerInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  baseBranch: string;
  reviewTimestamp: string;
  readmeContent: string;
  worktreePath: string;
  repoChanges: string;
  reviewFilePath: string;
}

export interface TodoVerifierInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  baseBranch: string;
  reviewTimestamp: string;
  todoContent: string;
  worktreePath: string;
  verifyFilePath: string;
}

export interface PRCreatorInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  baseBranch: string;
  worktreePath: string;
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
  repos: { repoPath: string; repoName: string; worktreePath: string }[];
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
}

export interface InitAnalyzeAndReadmeInput {
  description: string;
  readmeTemplate: string;
}

export interface CreateTodoPlannerInput {
  workspaceName: string;
  repoPath: string;
  repoName: string;
  readmeContent: string;
  worktreePath: string;
  reviewDir: string;
  taskType: string;
}
