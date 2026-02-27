/**
 * PR and repo change analysis utilities.
 */

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";
import { exec } from "./helpers";
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
  } catch (err) {
    console.debug("[pr] checkExistingPR failed (no PR exists or gh not available):", err);
    return { exists: false };
  }
}

// ---------------------------------------------------------------------------
// getRepoChanges
// ---------------------------------------------------------------------------

export function getRepoChanges(
  workspaceName: string,
  repoPath: string,
  baseBranch: string,
): RepoChanges {
  const worktreePath = path.join(WORKSPACE_DIR, workspaceName, repoPath);

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

  return { currentBranch, changedFiles, diffStat, commitLog };
}
