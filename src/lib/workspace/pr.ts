/**
 * PR and repo change analysis utilities.
 */

import { pathExists } from "@/lib/fs";
import { readFile } from "node:fs/promises";
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
export async function readPRTemplate(worktreePath: string): Promise<string | null> {
  for (const templatePath of PR_TEMPLATE_PATHS) {
    const fullPath = path.join(worktreePath, templatePath);
    if (await pathExists(fullPath)) {
      return await readFile(fullPath, "utf-8");
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// checkExistingPR
// ---------------------------------------------------------------------------

export async function checkExistingPR(worktreePath: string): Promise<ExistingPR> {
  try {
    const out = await execArgs(["gh", "pr", "view", "--json", "url,title,body"], { cwd: worktreePath });
    const pr = JSON.parse(out) as { url: string; title: string; body: string };
    return { exists: true, url: pr.url, title: pr.title, body: pr.body };
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
export async function getIncrementalChanges(
  worktreePath: string,
  baseBranch: string,
  sinceSha: string,
): Promise<{ sinceSha: string; changedFiles: string; diffStat: string; commitLog: string; hasChanges: boolean } | null> {
  if (!sinceSha.trim()) return null;

  // Ancestry, not mere existence: a rebased or force-pushed baseline still
  // resolves but no longer describes a point on this history, so a diff against
  // it would report unrelated churn as new work.
  try {
    await execArgs(["git", "-C", worktreePath, "merge-base", "--is-ancestor", sinceSha, "HEAD"]);
  } catch {
    return null;
  }

  const branchPaths = await (async () => {
    try {
      return (await execArgs([
        "git", "-C", worktreePath, "diff", "--name-only", `origin/${baseBranch}...HEAD`,
      ]))
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

  const run = async (args: string[]): Promise<string> => {
    try { return await execArgs(["git", "-C", worktreePath, ...args]); }
    catch { return ""; }
  };

  const [changedFiles, diffStat, commitLog] = await Promise.all([
    run(["diff", "--name-status", sinceSha, "HEAD", ...pathspec]),
    run(["diff", "--stat", sinceSha, "HEAD", ...pathspec]),
    // --no-merges --first-parent so the log names the branch's own commits and not
    // the ones a base-branch merge dragged along.
    run(["log", "--oneline", "--no-merges", "--first-parent", `${sinceSha}..HEAD`, ...pathspec]),
  ]);

  return {
    sinceSha,
    changedFiles,
    diffStat,
    commitLog,
    hasChanges: changedFiles.trim() !== "",
  };
}

export async function getRepoChanges(
  workspaceName: string,
  repoPath: string,
  baseBranch: string,
  sinceSha?: string,
): Promise<RepoChanges> {
  const worktreePath = path.join(getWorkspaceDir(), workspaceName, repoPath);

  // Fetch latest
  try {
    await exec(`git -C "${worktreePath}" fetch origin "${baseBranch}"`);
  } catch (err) {
    console.debug("[pr] fetch baseBranch failed, trying fetch all:", err);
    try { await exec(`git -C "${worktreePath}" fetch origin`); } catch { /* ignore fetch fallback */ }
  }

  const read = async (cmd: string, fallback: string): Promise<string> => {
    try { return await exec(`git -C "${worktreePath}" ${cmd}`); }
    catch { return fallback; }
  };

  const [currentBranch, changedFiles, diffStat, commitLog, incremental] = await Promise.all([
    read("branch --show-current", "(unknown)"),
    read(`diff --name-status "origin/${baseBranch}...HEAD"`, "(no changes)"),
    read(`diff --stat "origin/${baseBranch}...HEAD"`, "(no changes)"),
    read(`log --oneline "origin/${baseBranch}...HEAD"`, "(no commits)"),
    sinceSha ? getIncrementalChanges(worktreePath, baseBranch, sinceSha) : Promise.resolve(null),
  ]);

  return { currentBranch, changedFiles, diffStat, commitLog, incremental: incremental ?? undefined };
}
