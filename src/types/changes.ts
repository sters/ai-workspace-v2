/**
 * What each worktree of a workspace changes relative to its base branch: the
 * working tree against `merge-base(origin/<base>, HEAD)`, so uncommitted and
 * untracked work is included alongside the branch's commits.
 */

export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangedFile {
  /** Slash-separated, relative to the worktree. The new path for a rename. */
  path: string;
  oldPath?: string;
  status: ChangedFileStatus;
  /** `null` for a binary file, which git does not count in lines. */
  additions: number | null;
  deletions: number | null;
}

export interface RepoChangeSet {
  /** Relative to the workspace directory — what the chat session sees. */
  repoPath: string;
  repoName: string;
  baseBranch: string;
  /** The merge-base the files are compared against; `null` with `error`. */
  baseSha: string | null;
  files: ChangedFile[];
  error?: string;
}

export interface WorkspaceChanges {
  repos: RepoChangeSet[];
}

export interface FileDiff {
  diff: string;
  /** The diff was cut at `CHANGES_DIFF_MAX_BYTES`. */
  truncated: boolean;
}
