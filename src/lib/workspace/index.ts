// Barrel export for workspace modules

// Helpers
export { sanitizeSlug, detectBaseBranch } from "./helpers";
export type { StaleWorkspace, WorkspaceAgeInfo } from "./helpers";
export { listStaleWorkspaces, listAllWorkspacesWithAge } from "./helpers";

// Setup
export type { TaskAnalysis, SetupWorkspaceResult } from "./setup";
export { parseAnalysisResultText, setupWorkspace } from "./setup";

// Git operations
export type { WorkspaceRepo } from "./git";
export { listWorkspaceRepos, commitWorkspaceSnapshot, deleteWorkspace } from "./git";

// Templates
export { writeTodoTemplate, writeReportTemplates, prepareReviewDir } from "./templates";

// PR & repo analysis
export type { ExistingPR, RepoChanges } from "./pr";
export { checkExistingPR, getRepoChanges, readPRTemplate } from "./pr";
