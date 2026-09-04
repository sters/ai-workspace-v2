/**
 * Pipeline action: bring the workspace's worktrees up to the branches they
 * track, before a review reads them.
 *
 * This is the first half of a re-review. The second half is already in place:
 * `review.ts` records each repo's HEAD per session, so the review that follows
 * this phase scopes itself to `<last reviewed sha>..HEAD` — exactly the commits
 * the author pushed since. Without the phase that range is always empty and the
 * review re-reads the same code.
 *
 * It is **best-effort by design**: the phase reports what it could not move and
 * returns success anyway. Failing here would abort the operation before the
 * review, and a review of a slightly older commit is worth more than no review
 * — as long as it says so, which is what the result message is for.
 */

import { listWorkspaceRepos } from "@/lib/workspace/git";
import {
  isRefreshWarning,
  refreshWorktrees,
  summarizeWorktreeRefresh,
} from "@/lib/workspace/worktree-refresh";
import type { PipelinePhase } from "@/types/pipeline";

export const REFRESH_WORKTREES_PHASE_LABEL = "Refresh worktrees";

export function buildRefreshWorktreesPhase(input: {
  workspace: string;
  /** Single-repo filter, matching the review's own `repository` option. */
  repository?: string;
}): PipelinePhase {
  const { workspace, repository } = input;

  return {
    kind: "function",
    label: REFRESH_WORKTREES_PHASE_LABEL,
    timeoutMs: 10 * 60 * 1000,
    // A fetch that failed once fails the same way on a retry, and the phase
    // already treats failure as a reportable state rather than an error.
    maxRetries: 0,
    fn: async (ctx) => {
      // Read the repos here rather than at build time: this phase runs first,
      // and a workspace whose worktrees changed since the operation was queued
      // should be refreshed as it is now.
      const allRepos = listWorkspaceRepos(workspace);
      const repos = repository
        ? allRepos.filter((r) => r.repoPath === repository || r.repoName === repository)
        : allRepos;

      if (repos.length === 0) {
        ctx.emitResult("No repositories to refresh.");
        return true;
      }

      ctx.emitStatus(
        `Fetching and fast-forwarding ${repos.length} worktree(s) onto their tracked branches...`,
      );
      const results = refreshWorktrees(
        repos.map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
      );

      for (const result of results) {
        ctx.emitStatus(`[${result.status}] ${result.detail}`);
      }

      const warnings = results.filter((r) => isRefreshWarning(r.status));
      if (warnings.length > 0) {
        ctx.emitStatus(
          `${warnings.length} worktree(s) were left as they are — the review below does not read the pushed branch for those.`,
        );
      }

      ctx.emitResult(summarizeWorktreeRefresh(results));
      return true;
    },
  };
}
