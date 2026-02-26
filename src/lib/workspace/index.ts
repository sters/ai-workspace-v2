// Barrel export for workspace modules

// Helpers
export { sanitizeSlug } from "./helpers";
export type { StaleWorkspace, WorkspaceAgeInfo } from "./helpers";
export { listStaleWorkspaces, listAllWorkspacesWithAge } from "./helpers";

// Setup
export type { TaskAnalysis, SetupWorkspaceResult, SetupRepositoryResult } from "./setup";
export { parseAnalysisResultText, setupWorkspace, detectBaseBranch, setupRepository, buildReadmeContent } from "./setup";

// Git operations
export type { WorkspaceRepo } from "./git";
export { listWorkspaceRepos, commitWorkspaceSnapshot, deleteWorkspace } from "./git";

// Templates
export { writeTodoTemplate, writeReportTemplates, prepareReviewDir } from "./templates";

// PR & repo analysis
export type { ExistingPR, RepoChanges } from "./pr";
export { checkExistingPR, getRepoChanges } from "./pr";
