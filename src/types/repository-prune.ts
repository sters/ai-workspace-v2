/** What still depends on a clone: one of its worktrees, on disk. */
export interface RepositoryUsage {
  /** The workspace holding it, or `""` when the worktree sits outside `workspace/`. */
  workspace: string;
  worktreePath: string;
}

export interface RepositoryPruneCandidate {
  /** Path under `repositories/`, e.g. `github.com/org/repo`. */
  repoPath: string;
  repoName: string;
  /** ISO timestamp of the newest reference signal — see `lastReferencedAt`. */
  lastReferencedAt: string;
  /** Empty is the condition for deleting it. */
  usedBy: RepositoryUsage[];
  /**
   * Why usage could not be determined. Present means the clone is refused:
   * nothing established that it is unused.
   */
  usageError?: string;
}

export interface RepositoryPruneOutcome {
  repoPath: string;
  deleted: boolean;
  /** Why it was refused, or what failed. */
  reason?: string;
}
