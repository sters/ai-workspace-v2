/**
 * The git seam that the decision-making modules (`worktree-refresh`,
 * `base-merge`, `pr-title`, `repo-constraints-cache`) take as a parameter, so
 * their rules are unit-testable without a repository.
 */

import { runProcess } from "../process/run";

export interface GitResult {
  ok: boolean;
  /** Trimmed stdout on success, trimmed stderr on failure. */
  out: string;
}

export type GitExec = (args: string[], cwd: string) => Promise<GitResult>;

export const runGit: GitExec = async (args, cwd) => {
  try {
    const result = await runProcess(["git", ...args], { cwd });
    return { ok: result.success, out: (result.success ? result.stdout : result.stderr).trim() };
  } catch (err) {
    // A cwd that does not exist throws rather than failing.
    return { ok: false, out: String(err) };
  }
};
