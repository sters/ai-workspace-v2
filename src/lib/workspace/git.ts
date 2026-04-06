/**
 * Workspace git operations — listing repos, committing snapshots, deleting workspaces.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { exec, repoDir } from "./helpers";
import type { WorkspaceRepo } from "@/types/workspace";

// ---------------------------------------------------------------------------
// listWorkspaceRepos
// ---------------------------------------------------------------------------

export function listWorkspaceRepos(workspaceName: string): WorkspaceRepo[] {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!existsSync(wsPath)) return [];

  const repos: WorkspaceRepo[] = [];

  // Find directories containing .git (regular repos or worktrees) up to 4 levels deep
  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "artifacts" || entry.name === "tmp" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      // Check for .git (directory or file — worktrees use a file)
      const gitPath = path.join(fullPath, ".git");
      if (existsSync(gitPath)) {
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
// listAllRepositories
// ---------------------------------------------------------------------------

/**
 * List all git repositories under the top-level `repositories/` directory.
 * Unlike `listWorkspaceRepos`, which walks a specific workspace's directory,
 * this walks the shared `repositories/` directory to find the source repos.
 */
export function listAllRepositories(): WorkspaceRepo[] {
  const base = repoDir();
  if (!existsSync(base)) return [];

  const repos: WorkspaceRepo[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "artifacts" || entry.name === "tmp" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      const gitPath = path.join(fullPath, ".git");
      if (existsSync(gitPath)) {
        const relPath = path.relative(base, fullPath);
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

  walk(base, 1);
  repos.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
  return repos;
}

// ---------------------------------------------------------------------------
// commitWorkspaceSnapshot
// ---------------------------------------------------------------------------

export async function commitWorkspaceSnapshot(
  workspaceName: string,
  message?: string,
): Promise<boolean> {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!existsSync(path.join(wsPath, ".git"))) return false;

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
  // Use Bun.Glob for TODO files
  const todoGlob = new Bun.Glob("TODO-*.md");
  const todoFiles = [...todoGlob.scanSync({ cwd: wsPath })];
  for (const f of todoFiles) {
    try { exec(`git -C "${wsPath}" add "${f}"`); } catch { /* ignore */ }
  }
  // Note: template files are in templates/ which is gitignored
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
      const content = await Bun.file(path.join(wsPath, f)).text();
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
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!existsSync(wsPath)) {
    throw new Error(`Workspace directory not found: ${wsPath}`);
  }

  // Collect repository paths that have worktrees
  const repoPaths: string[] = [];
  const repos = listWorkspaceRepos(workspaceName);
  for (const repo of repos) {
    const repoSource = path.join(repoDir(), repo.repoPath);
    if (existsSync(repoSource)) {
      repoPaths.push(repoSource);
    }
  }

  // Remove workspace directory (operation logs are kept in SQLite for history)
  rmSync(wsPath, { recursive: true, force: true });

  // Prune worktree references
  for (const rp of repoPaths) {
    try {
      exec(`git -C "${rp}" worktree prune`);
    } catch { /* non-critical */ }
  }
}
