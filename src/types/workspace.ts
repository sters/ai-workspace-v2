export interface TodoItem {
  text: string;
  status: "completed" | "pending" | "blocked" | "in_progress";
  indent: number;
  children: string[];
}

export interface TodoSection {
  heading: string;
  items: TodoItem[];
  notes: string[];
}

export interface TodoFile {
  filename: string;
  repoName: string;
  items: TodoItem[];
  sections: TodoSection[];
  completed: number;
  pending: number;
  blocked: number;
  inProgress: number;
  total: number;
  progress: number;
}

export interface WorkspaceMeta {
  title: string;
  taskType: string;
  ticketId: string;
  date: string;
  repositories: { alias: string; path: string; baseBranch: string }[];
}

/**
 * A single Acceptance Criteria item from the README's `## Acceptance Criteria`
 * section. `kind` distinguishes what an agent may do about it:
 * - "auto": the agent can verify it with evidence (command exit code, code
 *   presence, API behavior). Only unmet `auto` criteria gate the autonomous loop.
 * - "manual": requires a human to confirm (visual QA, staging sign-off). Agents
 *   never attempt these; they are surfaced as a handoff checklist.
 */
export interface AcceptanceCriterion {
  text: string;
  kind: "auto" | "manual";
  checked: boolean;
}

export interface ReviewSession {
  timestamp: string;
  repos: number;
  critical: number;
  warnings: number;
  suggestions: number;
}

export interface WorkspaceSummary {
  name: string;
  path: string;
  meta: WorkspaceMeta;
  todos: TodoFile[];
  overallProgress: number;
  totalCompleted: number;
  totalItems: number;
  lastModified: string;
}

/** Lightweight summary for workspace list / card rendering. */
export interface WorkspaceListItem {
  name: string;
  title: string;
  taskType: string;
  ticketId: string;
  date: string;
  repoCount: number;
  overallProgress: number;
  totalCompleted: number;
  totalItems: number;
  lastModified: string;
  archived?: boolean;
}

export interface HistoryEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface WorkspaceRepo {
  /** e.g. github.com/org/repo */
  repoPath: string;
  /** e.g. repo */
  repoName: string;
  /** absolute path to worktree */
  worktreePath: string;
}

export interface TaskAnalysis {
  taskType: string;
  slug: string;
  ticketId: string;
  repositories: string[];
}

export interface StaleWorkspace {
  name: string;
  lastModified: Date;
}

export interface WorkspaceAgeInfo {
  name: string;
  lastModified: Date;
  ageDays: number;
  isStale: boolean;
}

export interface ExistingPR {
  exists: boolean;
  url?: string;
  title?: string;
  body?: string;
}

export interface RepoChanges {
  currentBranch: string;
  changedFiles: string;
  diffStat: string;
  commitLog: string;
  /**
   * The branch's own work since a prior review's recorded HEAD. Absent when no
   * baseline was recorded or it is no longer usable, which is the caller's cue to
   * review the whole branch.
   */
  incremental?: {
    sinceSha: string;
    changedFiles: string;
    diffStat: string;
    commitLog: string;
    hasChanges: boolean;
  };
}
