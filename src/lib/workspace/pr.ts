/**
 * PR and repo change analysis utilities.
 */

import fs from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { exec, execArgs } from "./helpers";
import type { ExistingPR, RepoChanges } from "@/types/workspace";

// ---------------------------------------------------------------------------
// readPRTemplate
// ---------------------------------------------------------------------------

const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE/default.md",
  ".github/pull_request_template/default.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
];

/**
 * Read the PR template from a repository worktree.
 * Searches standard GitHub PR template locations in priority order.
 * Returns the template content or null if not found.
 */
export function readPRTemplate(worktreePath: string): string | null {
  for (const templatePath of PR_TEMPLATE_PATHS) {
    const fullPath = path.join(worktreePath, templatePath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf-8");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// checkExistingPR
// ---------------------------------------------------------------------------

export function checkExistingPR(worktreePath: string): ExistingPR {
  try {
    const url = exec(`gh pr view --json url -q ".url"`, { cwd: worktreePath });
    const title = exec(`gh pr view --json title -q ".title"`, { cwd: worktreePath });
    const body = exec(`gh pr view --json body -q ".body"`, { cwd: worktreePath });
    return { exists: true, url, title, body };
  } catch {
    return { exists: false };
  }
}

// ---------------------------------------------------------------------------
// getRepoChanges
// ---------------------------------------------------------------------------

/**
 * Paths beyond which the pathspec is dropped rather than risking an argv that
 * exceeds the OS limit. Well above a reviewable change; a branch this wide gets
 * the unrestricted range, which is a wider review, not a wrong one.
 */
const MAX_PATHSPEC_ENTRIES = 400;

/**
 * The branch's own new work since `sinceSha`, for a re-review that should look at
 * what changed rather than at the whole branch again.
 *
 * Returns null when `sinceSha` is unusable — absent, or no longer an ancestor of
 * HEAD after a rebase or force-push. Null means "no usable baseline", and the
 * caller's correct response is a full-branch review, not an error.
 *
 * Restricted to paths the branch itself touches (`origin/<base>...HEAD`), because
 * `<sinceSha>..HEAD` also contains everything a mid-run `origin/<base>` merge
 * brought in — on the branch this was written for, 10 of 12 commits in that range
 * belonged to other teams. The restriction is an approximation in one direction:
 * a file both the branch and the base branch changed stays in scope, which is
 * wanted, since that is where a merge resolution lands.
 */
export function getIncrementalChanges(
  worktreePath: string,
  baseBranch: string,
  sinceSha: string,
): { sinceSha: string; changedFiles: string; diffStat: string; commitLog: string; hasChanges: boolean } | null {
  if (!sinceSha.trim()) return null;

  // Ancestry, not mere existence: a rebased or force-pushed baseline still
  // resolves but no longer describes a point on this history, so a diff against
  // it would report unrelated churn as new work.
  try {
    execArgs(["git", "-C", worktreePath, "merge-base", "--is-ancestor", sinceSha, "HEAD"]);
  } catch {
    return null;
  }

  const branchPaths = (() => {
    try {
      return execArgs([
        "git", "-C", worktreePath, "diff", "--name-only", `origin/${baseBranch}...HEAD`,
      ])
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "");
    } catch {
      return [];
    }
  })();

  const pathspec =
    branchPaths.length > 0 && branchPaths.length <= MAX_PATHSPEC_ENTRIES
      ? ["--", ...branchPaths]
      : [];

  const run = (args: string[]): string => {
    try { return execArgs(["git", "-C", worktreePath, ...args]); }
    catch { return ""; }
  };

  const changedFiles = run(["diff", "--name-status", sinceSha, "HEAD", ...pathspec]);
  const diffStat = run(["diff", "--stat", sinceSha, "HEAD", ...pathspec]);
  // --no-merges --first-parent so the log names the branch's own commits and not
  // the ones a base-branch merge dragged along.
  const commitLog = run([
    "log", "--oneline", "--no-merges", "--first-parent", `${sinceSha}..HEAD`, ...pathspec,
  ]);

  return {
    sinceSha,
    changedFiles,
    diffStat,
    commitLog,
    hasChanges: changedFiles.trim() !== "",
  };
}

export function getRepoChanges(
  workspaceName: string,
  repoPath: string,
  baseBranch: string,
  sinceSha?: string,
): RepoChanges {
  const worktreePath = path.join(getWorkspaceDir(), workspaceName, repoPath);

  // Fetch latest
  try {
    exec(`git -C "${worktreePath}" fetch origin "${baseBranch}"`);
  } catch (err) {
    console.debug("[pr] fetch baseBranch failed, trying fetch all:", err);
    try { exec(`git -C "${worktreePath}" fetch origin`); } catch { /* ignore fetch fallback */ }
  }

  const currentBranch = (() => {
    try { return exec(`git -C "${worktreePath}" branch --show-current`); }
    catch { return "(unknown)"; }
  })();

  const changedFiles = (() => {
    try { return exec(`git -C "${worktreePath}" diff --name-status "origin/${baseBranch}...HEAD"`); }
    catch { return "(no changes)"; }
  })();

  const diffStat = (() => {
    try { return exec(`git -C "${worktreePath}" diff --stat "origin/${baseBranch}...HEAD"`); }
    catch { return "(no changes)"; }
  })();

  const commitLog = (() => {
    try { return exec(`git -C "${worktreePath}" log --oneline "origin/${baseBranch}...HEAD"`); }
    catch { return "(no commits)"; }
  })();

  const incremental = sinceSha
    ? getIncrementalChanges(worktreePath, baseBranch, sinceSha) ?? undefined
    : undefined;

  return { currentBranch, changedFiles, diffStat, commitLog, incremental };
}
