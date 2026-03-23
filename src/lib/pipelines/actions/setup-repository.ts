/**
 * Pipeline action: set up a git worktree for a repository within a workspace.
 * Handles cloning, fetching, branch creation, worktree setup, and conflict resolution.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { exec, repoDir, detectBaseBranch } from "@/lib/workspace/helpers";
import type { SetupRepositoryResult } from "@/types/pipeline";

export function setupRepository(
  workspaceName: string,
  repositoryPathArg: string,
  baseBranchOverride: string | undefined,
  emitStatus: (message: string) => void,
  checkoutBranch?: string,
): SetupRepositoryResult {
  // Parse alias syntax (e.g. github.com/org/repo:dev)
  let actualRepoPath = repositoryPathArg;
  let repoAlias = "";
  let repoPathInput = repositoryPathArg;
  if (repositoryPathArg.includes(":")) {
    actualRepoPath = repositoryPathArg.split(":")[0];
    repoAlias = repositoryPathArg.split(":").slice(1).join(":");
    repoPathInput = `${actualRepoPath}___${repoAlias}`;
  }

  const repoName = path.basename(repoPathInput);
  const repoAbsPath = path.join(repoDir(), actualRepoPath);
  const wsPath = path.join(getWorkspaceDir(), workspaceName);

  if (!existsSync(wsPath)) {
    throw new Error(`Workspace directory does not exist: ${wsPath}`);
  }

  // Clone or fetch
  if (!existsSync(repoAbsPath)) {
    emitStatus(`Repository not found locally, cloning ${actualRepoPath}...`);
    const parentDir = path.dirname(repoAbsPath);
    mkdirSync(parentDir, { recursive: true });
    const repoUrl = `https://${actualRepoPath}.git`;
    exec(`git clone "${repoUrl}" "${repoAbsPath}"`);
    emitStatus("Clone complete.");
    try {
      exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
  } else {
    emitStatus(`Repository found locally, fetching latest...`);
    exec(`git -C "${repoAbsPath}" fetch --all --prune`);
    try {
      exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
  }

  // Detect base branch
  const baseBranch = baseBranchOverride ?? detectBaseBranch(repoAbsPath);
  emitStatus(`Base branch: ${baseBranch}`);

  // Create worktree — use absolute path so git -C doesn't resolve it
  // relative to the repository directory
  const worktreePath = path.resolve(path.join(wsPath, repoPathInput));
  mkdirSync(path.dirname(worktreePath), { recursive: true });

  let branchName: string;

  if (checkoutBranch) {
    // --- Checkout existing remote branch (PR-based setup) ---
    branchName = checkoutBranch;

    // If the target directory already exists, remove it
    if (existsSync(worktreePath)) {
      emitStatus(`Target directory already exists, removing: ${repoPathInput}`);
      rmSync(worktreePath, { recursive: true, force: true });
      try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
    }

    emitStatus(`Creating worktree: checking out existing branch ${checkoutBranch}`);
    exec(
      `git -C "${repoAbsPath}" worktree add "${worktreePath}" "origin/${checkoutBranch}"`,
    );
    exec(
      `git -C "${worktreePath}" checkout -B "${checkoutBranch}" --track "origin/${checkoutBranch}"`,
    );
  } else {
    // --- Create new branch (default behavior) ---

    // Extract task info from workspace name for branch naming
    const parts = workspaceName.split("-");
    const taskType = parts[0];
    const dateMatch = workspaceName.match(/(\d{8})$/);
    const date = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");

    // Detect ticket ID
    let ticketId = "";
    let description: string;
    if (parts.length > 1 && /^[A-Z]+[-]?\d+$/i.test(parts[1])) {
      ticketId = parts[1];
      description = workspaceName
        .replace(new RegExp(`^${taskType}-${ticketId}-`), "")
        .replace(new RegExp(`-${date}$`), "");
    } else {
      description = workspaceName
        .replace(new RegExp(`^${taskType}-`), "")
        .replace(new RegExp(`-${date}$`), "");
    }

    // Build branch name
    if (ticketId) {
      branchName = repoAlias
        ? `${taskType}/${ticketId}-${description}-${repoAlias}`
        : `${taskType}/${ticketId}-${description}`;
    } else {
      branchName = repoAlias
        ? `${taskType}/${description}-${repoAlias}`
        : `${taskType}/${description}-${date}`;
    }

    // If the branch already exists, resolve the conflict
    try {
      exec(`git -C "${repoAbsPath}" rev-parse --verify "${branchName}"`);
      emitStatus(`Branch ${branchName} already exists, resolving...`);
      try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }

      const worktreeList = exec(`git -C "${repoAbsPath}" worktree list --porcelain`);
      const isInUse = worktreeList
        .split("\n")
        .some((line) => line === `branch refs/heads/${branchName}`);

      if (isInUse) {
        const origName = branchName;
        let suffix = 2;
        while (true) {
          const candidate = `${branchName}-${suffix}`;
          try {
            exec(`git -C "${repoAbsPath}" rev-parse --verify "${candidate}"`);
            suffix++;
          } catch {
            branchName = candidate;
            break;
          }
        }
        emitStatus(`Branch ${origName} in use by another worktree, using ${branchName} instead.`);
      } else {
        emitStatus(`Branch is stale, deleting and recreating.`);
        exec(`git -C "${repoAbsPath}" branch -D "${branchName}"`);
      }
    } catch {
      // Branch doesn't exist — good
    }

    // If the target directory already exists (e.g. from a previous failed attempt),
    // remove it before creating the worktree
    if (existsSync(worktreePath)) {
      emitStatus(`Target directory already exists, removing: ${repoPathInput}`);
      rmSync(worktreePath, { recursive: true, force: true });
      try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
    }

    emitStatus(`Creating worktree: branch ${branchName} from origin/${baseBranch}`);
    const worktreeOutput = exec(
      `git -C "${repoAbsPath}" worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`,
    );
    if (worktreeOutput) {
      emitStatus(`git worktree add: ${worktreeOutput}`);
    }
  }

  // Verify the worktree was actually created
  if (!existsSync(path.join(worktreePath, ".git"))) {
    // Log diagnostic info
    const list = exec(`git -C "${repoAbsPath}" worktree list`);
    emitStatus(`Worktree list after add: ${list}`);
    throw new Error(
      `git worktree add returned successfully but ${worktreePath}/.git does not exist. ` +
      `repoAbsPath=${repoAbsPath}, branchName=${branchName}, baseBranch=origin/${baseBranch}`,
    );
  }
  emitStatus(`Worktree ready at ${repoPathInput}`);

  return {
    repoPath: repoPathInput,
    repoName,
    worktreePath,
    baseBranch,
    branchName,
  };
}
