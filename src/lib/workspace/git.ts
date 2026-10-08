/**
 * Workspace git operations — listing repos, committing snapshots, deleting workspaces.
 */

import { globScan, pathExists } from "@/lib/fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { exec, execArgs, repoDir } from "./helpers";
import type { WorkspaceRepo } from "@/types/workspace";

// ---------------------------------------------------------------------------
// listWorkspaceRepos
// ---------------------------------------------------------------------------

export async function listWorkspaceRepos(workspaceName: string): Promise<WorkspaceRepo[]> {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!(await pathExists(wsPath))) return [];

  const repos: WorkspaceRepo[] = [];

  // Find directories containing .git (regular repos or worktrees) up to 4 levels deep
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "artifacts" || entry.name === "tmp" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      // Check for .git (directory or file — worktrees use a file)
      const gitPath = path.join(fullPath, ".git");
      if (await pathExists(gitPath)) {
        const relPath = path.relative(wsPath, fullPath);
        repos.push({
          repoPath: relPath,
          repoName: path.basename(relPath),
          worktreePath: fullPath,
        });
      } else {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(wsPath, 1);
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
export async function listAllRepositories(): Promise<WorkspaceRepo[]> {
  const base = repoDir();
  if (!(await pathExists(base))) return [];

  const repos: WorkspaceRepo[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "artifacts" || entry.name === "tmp" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      const gitPath = path.join(fullPath, ".git");
      if (await pathExists(gitPath)) {
        const relPath = path.relative(base, fullPath);
        repos.push({
          repoPath: relPath,
          repoName: path.basename(relPath),
          worktreePath: fullPath,
        });
      } else {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(base, 1);
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
  if (!(await pathExists(path.join(wsPath, ".git")))) return false;

  // Check for changes
  try {
    await exec(`git -C "${wsPath}" diff --quiet HEAD -- README.md`);
    await exec(`git -C "${wsPath}" diff --cached --quiet -- README.md`);
    // Also check TODO and artifacts
    try { await exec(`git -C "${wsPath}" diff --quiet HEAD -- . -- ':!github.com' ':!gitlab.com' ':!bitbucket.org' ':!tmp'`); } catch { /* has changes */ }
  } catch { /* has changes, proceed */ }

  // Stage changes
  try { await exec(`git -C "${wsPath}" add README.md`); } catch { /* no README */ }
  try { await exec(`git -C "${wsPath}" add "TODO-*.md" 2>/dev/null || true`); } catch { /* no TODOs */ }
  // Use Bun.Glob for TODO files
  const todoGlob = new Bun.Glob("TODO-*.md");
  const todoFiles = (await globScan(todoGlob, wsPath));
  for (const f of todoFiles) {
    try { await exec(`git -C "${wsPath}" add "${f}"`); } catch { /* ignore */ }
  }
  // Note: template files are in templates/ which is gitignored
  try { await exec(`git -C "${wsPath}" add artifacts/`); } catch { /* no artifacts */ }

  // Check if there are staged changes
  try {
    await exec(`git -C "${wsPath}" diff --cached --quiet`);
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

  await execArgs(["git", "-C", wsPath, "commit", "-m", commitMsg]);
  return true;
}

// ---------------------------------------------------------------------------
// deleteWorkspace
// ---------------------------------------------------------------------------

export async function deleteWorkspace(workspaceName: string): Promise<void> {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!(await pathExists(wsPath))) {
    throw new Error(`Workspace directory not found: ${wsPath}`);
  }

  // Collect repository paths that have worktrees
  const repoPaths: string[] = [];
  const repos = await listWorkspaceRepos(workspaceName);
  for (const repo of repos) {
    const repoSource = path.join(repoDir(), repo.repoPath);
    if (await pathExists(repoSource)) {
      repoPaths.push(repoSource);
    }
  }

  // Remove workspace directory (operation logs are kept in SQLite for history)
  await rm(wsPath, { recursive: true, force: true });

  // Prune worktree references
  for (const rp of repoPaths) {
    try {
      await exec(`git -C "${rp}" worktree prune`);
    } catch { /* non-critical */ }
  }
}
