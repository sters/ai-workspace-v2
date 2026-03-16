/**
 * Pipeline action: manage sub-worktrees for Best-of-N parallel execution.
 * Creates N sub-worktrees per repository, collects diffs, applies results, and cleans up.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR } from "@/lib/config";
import { exec, repoDir } from "@/lib/workspace/helpers";
import type { WorkspaceRepo } from "@/types/workspace";

export interface SubWorktree {
  index: number;
  label: string;
  /** Map from original repoPath to sub-worktree absolute path. */
  repoPaths: Map<string, string>;
  /** Map from original repoPath to sub-worktree branch name. */
  branchNames: Map<string, string>;
  /** Repos associated with this candidate. */
  repos: WorkspaceRepo[];
}

/**
 * Create N sub-worktrees for each repo in the workspace.
 * Each sub-worktree branches from the current HEAD of the original worktree.
 */
export function createSubWorktrees(
  workspaceName: string,
  repos: WorkspaceRepo[],
  n: number,
  emitStatus: (message: string) => void,
): SubWorktree[] {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);
  const subWorktrees: SubWorktree[] = [];

  for (let i = 0; i < n; i++) {
    const label = `candidate-${i + 1}`;
    const bonDir = path.join("tmp", `bon-${i + 1}`);
    const repoPaths = new Map<string, string>();
    const branchNames = new Map<string, string>();
    const candidateRepos: WorkspaceRepo[] = [];

    for (const repo of repos) {
      const existingWtPath = repo.worktreePath;
      const repoAbsPath = path.join(repoDir(), repo.repoPath);

      // Get the current HEAD of the existing worktree
      const baseCommit = exec(`git -C "${existingWtPath}" rev-parse HEAD`);

      // Get the current branch name for naming
      let currentBranch: string;
      try {
        currentBranch = exec(`git -C "${existingWtPath}" rev-parse --abbrev-ref HEAD`);
      } catch {
        currentBranch = `detached-${baseCommit.slice(0, 8)}`;
      }

      const bonBranch = `${currentBranch}-bon-${i + 1}`;
      const subWtPath = path.resolve(path.join(wsPath, bonDir, repo.repoPath));

      // Remove stale sub-worktree directory if it exists
      if (existsSync(subWtPath)) {
        rmSync(subWtPath, { recursive: true, force: true });
        try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
      }

      // Delete stale branch if it exists and is not in use
      try {
        exec(`git -C "${repoAbsPath}" rev-parse --verify "${bonBranch}"`);
        // Branch exists — check if it's in use by a worktree
        try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
        const worktreeList = exec(`git -C "${repoAbsPath}" worktree list --porcelain`);
        const isInUse = worktreeList
          .split("\n")
          .some((line) => line === `branch refs/heads/${bonBranch}`);
        if (!isInUse) {
          exec(`git -C "${repoAbsPath}" branch -D "${bonBranch}"`);
        }
      } catch { /* branch doesn't exist — good */ }

      // Create sub-worktree
      mkdirSync(path.dirname(subWtPath), { recursive: true });
      emitStatus(`[${label}] Creating sub-worktree for ${repo.repoName}`);
      exec(
        `git -C "${repoAbsPath}" worktree add -b "${bonBranch}" "${subWtPath}" "${baseCommit}"`,
      );

      repoPaths.set(repo.repoPath, subWtPath);
      branchNames.set(repo.repoPath, bonBranch);
      candidateRepos.push({
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        worktreePath: subWtPath,
      });
    }

    subWorktrees.push({
      index: i,
      label,
      repoPaths,
      branchNames,
      repos: candidateRepos,
    });
  }

  return subWorktrees;
}

/**
 * Get a combined diff for a sub-worktree relative to a base commit.
 */
export function getSubWorktreeDiff(
  subWorktreePath: string,
  baseCommit: string,
): string {
  try {
    return exec(`git -C "${subWorktreePath}" diff "${baseCommit}"..HEAD`);
  } catch {
    return "";
  }
}

/**
 * Get the base commit (common ancestor) of the sub-worktree — the commit it branched from.
 */
export function getBaseCommit(
  originalWorktreePath: string,
  subWorktreePath: string,
): string {
  const origHead = exec(`git -C "${originalWorktreePath}" rev-parse HEAD`);
  const subHead = exec(`git -C "${subWorktreePath}" rev-parse HEAD`);
  return exec(`git -C "${subWorktreePath}" merge-base "${origHead}" "${subHead}"`);
}

/**
 * Apply a sub-worktree's commits to the original worktree using format-patch + am.
 */
export function applySubWorktreeResult(
  originalWorktreePath: string,
  subWorktreePath: string,
  baseCommit: string,
): void {
  // Check if there are any commits to apply
  const commitCount = exec(
    `git -C "${subWorktreePath}" rev-list --count "${baseCommit}"..HEAD`,
  );
  if (commitCount === "0") return;

  // Generate patches
  const patchDir = path.join(subWorktreePath, ".bon-patches");
  mkdirSync(patchDir, { recursive: true });
  exec(
    `git -C "${subWorktreePath}" format-patch -o "${patchDir}" "${baseCommit}"..HEAD`,
  );

  // Apply patches to the original worktree
  try {
    exec(`git -C "${originalWorktreePath}" am "${patchDir}"/*.patch`);
  } finally {
    // Clean up patch directory
    rmSync(patchDir, { recursive: true, force: true });
  }
}

/**
 * Clean up all sub-worktrees created for a Best-of-N run.
 */
export function cleanupSubWorktrees(
  workspaceName: string,
  subWorktrees: SubWorktree[],
  repos: WorkspaceRepo[],
  emitStatus: (message: string) => void,
): void {
  const wsPath = path.join(WORKSPACE_DIR, workspaceName);

  for (const sub of subWorktrees) {
    for (const repo of repos) {
      const subWtPath = sub.repoPaths.get(repo.repoPath);
      const bonBranch = sub.branchNames.get(repo.repoPath);
      const repoAbsPath = path.join(repoDir(), repo.repoPath);

      // Remove the sub-worktree directory
      if (subWtPath && existsSync(subWtPath)) {
        try {
          rmSync(subWtPath, { recursive: true, force: true });
        } catch (err) {
          emitStatus(`[cleanup] Failed to remove ${subWtPath}: ${err}`);
        }
      }

      // Prune worktree references
      try {
        exec(`git -C "${repoAbsPath}" worktree prune`);
      } catch { /* non-critical */ }

      // Delete the temporary branch
      if (bonBranch) {
        try {
          exec(`git -C "${repoAbsPath}" branch -D "${bonBranch}"`);
        } catch { /* branch may not exist or is in use */ }
      }
    }

    // Remove the tmp/bon-N directory from workspace
    const bonDir = path.join(wsPath, "tmp", `bon-${sub.index + 1}`);
    if (existsSync(bonDir)) {
      try {
        rmSync(bonDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }

  emitStatus("Sub-worktrees cleaned up");
}
