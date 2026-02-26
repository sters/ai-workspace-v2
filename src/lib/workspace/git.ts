/**
 * Workspace git operations — listing repos, committing snapshots, deleting workspaces.
 */

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "../config";
import { exec, repoDir } from "./helpers";

// ---------------------------------------------------------------------------
// listWorkspaceRepos
// ---------------------------------------------------------------------------

export interface WorkspaceRepo {
  /** e.g. github.com/org/repo */
  repoPath: string;
  /** e.g. repo */
  repoName: string;
  /** absolute path to worktree */
  worktreePath: string;
}

export function listWorkspaceRepos(workspaceName: string): WorkspaceRepo[] {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
  if (!fs.existsSync(wsPath)) return [];

  const repos: WorkspaceRepo[] = [];

  // Find directories containing .git (regular repos or worktrees) up to 4 levels deep
  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "artifacts" || entry.name === "tmp" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      // Check for .git (directory or file — worktrees use a file)
      const gitPath = path.join(fullPath, ".git");
      if (fs.existsSync(gitPath)) {
        const relPath = path.relative(wsPath, fullPath);
        repos.push({
          repoPath: relPath,
          repoName: path.basename(relPath),
          worktreePath: fullPath,
        });
      } else {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(wsPath, 1);
  repos.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return repos;
}

// ---------------------------------------------------------------------------
// commitWorkspaceSnapshot
// ---------------------------------------------------------------------------

export function commitWorkspaceSnapshot(
  workspaceName: string,
  message?: string,
): boolean {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
  if (!fs.existsSync(path.join(wsPath, ".git"))) return false;

  // Check for changes
  try {
    exec(`git -C "${wsPath}" diff --quiet HEAD -- README.md`);
    exec(`git -C "${wsPath}" diff --cached --quiet -- README.md`);
    // Also check TODO and artifacts
    try { exec(`git -C "${wsPath}" diff --quiet HEAD -- . -- ':!github.com' ':!gitlab.com' ':!bitbucket.org' ':!tmp'`); } catch { /* has changes */ }
  } catch { /* has changes, proceed */ }

  // Stage changes
  try { exec(`git -C "${wsPath}" add README.md`); } catch { /* no README */ }
  try { exec(`git -C "${wsPath}" add "TODO-*.md" 2>/dev/null || true`); } catch { /* no TODOs */ }
  // Use shell glob for TODO files
  const todoFiles = fs.readdirSync(wsPath).filter(f => /^TODO-.*\.md$/.test(f));
  for (const f of todoFiles) {
    try { exec(`git -C "${wsPath}" add "${f}"`); } catch { /* ignore */ }
  }
  // Stage template files
  const templateFiles = fs.readdirSync(wsPath).filter(f => /^.*-template\.md$/.test(f));
  for (const f of templateFiles) {
    try { exec(`git -C "${wsPath}" add "${f}"`); } catch { /* ignore */ }
  }
  try { exec(`git -C "${wsPath}" add artifacts/`); } catch { /* no artifacts */ }

  // Check if there are staged changes
  try {
    exec(`git -C "${wsPath}" diff --cached --quiet`);
    return false; // no changes
  } catch { /* has staged changes, proceed */ }

  // Auto-generate message if not provided
  let commitMsg = message;
  if (!commitMsg) {
    let completed = 0;
    let total = 0;
    for (const f of todoFiles) {
      const content = fs.readFileSync(path.join(wsPath, f), "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (/^\s*- \[x\]/.test(line)) { completed++; total++; }
        else if (/^\s*- \[ \]/.test(line)) { total++; }
        else if (/^\s*- \[!\]/.test(line)) { total++; }
        else if (/^\s*- \[~\]/.test(line)) { total++; }
      }
    }
    commitMsg = total > 0
      ? `Snapshot: ${completed}/${total} TODO items completed`
      : "Snapshot: workspace updated";
  }

  exec(`git -C "${wsPath}" commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
  return true;
}

// ---------------------------------------------------------------------------
// deleteWorkspace
// ---------------------------------------------------------------------------

export function deleteWorkspace(workspaceName: string): void {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
  if (!fs.existsSync(wsPath)) {
    throw new Error(`Workspace directory not found: ${wsPath}`);
  }

  // Collect repository paths that have worktrees
  const repoPaths: string[] = [];
  const repos = listWorkspaceRepos(workspaceName);
  for (const repo of repos) {
    const repoSource = path.join(repoDir(), repo.repoPath);
    if (fs.existsSync(repoSource)) {
      repoPaths.push(repoSource);
    }
  }

  // Remove workspace directory
  fs.rmSync(wsPath, { recursive: true, force: true });

  // Prune worktree references
  for (const rp of repoPaths) {
    try {
      exec(`git -C "${rp}" worktree prune`);
    } catch { /* non-critical */ }
  }
}
