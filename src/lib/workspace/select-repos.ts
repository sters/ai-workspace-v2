import type { WorkspaceRepo } from "@/types/workspace";

/**
 * Narrow a workspace's worktrees to the ones an operation acts on.
 *
 * `repository` is the single-repo filter a caller passes for the whole run (a
 * worktree directory name or the repository path). `repositories` is the set an
 * autonomous cycle is still working on, named by worktree directory; it
 * intersects with `repository` rather than replacing it.
 */
export function selectRepos(
  allRepos: WorkspaceRepo[],
  filter: { repository?: string; repositories?: readonly string[] },
): WorkspaceRepo[] {
  const { repository, repositories } = filter;
  const named = repository
    ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
    : allRepos;
  if (!repositories) return named;
  const wanted = new Set(repositories);
  return named.filter((r) => wanted.has(r.repoName));
}
