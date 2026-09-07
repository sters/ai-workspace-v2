/**
 * Pipeline action: set up a git worktree for a repository within a workspace.
 * Handles cloning, fetching, branch creation, worktree setup, and conflict resolution.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { exec, repoDir, detectBaseBranch, remoteBranchExists } from "@/lib/workspace/helpers";
import type { SetupRepositoryResult } from "@/types/pipeline";

/** Waits before each retry of the initial fetch; its length is the attempt count. */
const FETCH_RETRY_DELAYS_MS = [500, 2000];

/**
 * Caps the search for an unused branch name. The probe asks git whether a name
 * is taken, so a git that answers "yes" to everything makes the search endless
 * — and the search runs one subprocess per name, which is why it has to be the
 * search that stops rather than the caller.
 */
const MAX_BRANCH_NAME_ATTEMPTS = 100;

/**
 * Git reports why a fetch failed at the *end* of its transcript of ref updates,
 * so on a repository with thousands of branches the first lines of stderr say
 * nothing about the failure. Keep the `error:` / `fatal:` lines.
 */
function gitFailureReason(err: unknown): string {
  const lines = String(err)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const reasons = lines.filter((l) => /^(error|fatal):/.test(l));
  return (reasons.length > 0 ? reasons : lines.slice(0, 1)).slice(0, 3).join(" ");
}

/**
 * Fetch every remote, retrying a failure a few times, and report whether the
 * refs on disk ended up current.
 *
 * A fetch of a busy repository fails for reasons that have nothing to do with
 * this workspace, and it fails *after* updating most refs: a ref that moved
 * mid-fetch (`incorrect old value provided`) clears on a retry, while a remote
 * carrying two refs that differ only in casing cannot be stored on a
 * case-insensitive filesystem at all and fails every time. Neither is a reason
 * to abandon setup — the worktree is created from `origin/<base>`, which is
 * either present (possibly a few commits stale) or missing, and `worktree add`
 * says so loudly.
 */
function fetchAllWithRetries(
  repoAbsPath: string,
  emitStatus: (message: string) => void,
): boolean {
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      exec(`git -C "${repoAbsPath}" fetch --all --prune`);
      return true;
    } catch (err) {
      const reason = gitFailureReason(err);
      const delay = FETCH_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        emitStatus(
          `Warning: fetch failed after ${attempt + 1} attempts, continuing with the refs already on disk: ${reason}`,
        );
        return false;
      }
      emitStatus(`fetch failed, retrying in ${delay}ms: ${reason}`);
      Bun.sleepSync(delay);
    }
  }
  return false;
}

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
    fetchAllWithRetries(repoAbsPath, emitStatus);
    try {
      exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
  }

  // Detect base branch. A README-declared override (e.g. `main`) may not match
  // the repo's actual default branch (e.g. `master`); trusting it blindly makes
  // the later `worktree add ... origin/<branch>` fail with `invalid reference`.
  // So if the override doesn't exist on the remote, fall back to the detected default.
  let baseBranch = baseBranchOverride ?? detectBaseBranch(repoAbsPath);
  if (baseBranchOverride && !remoteBranchExists(repoAbsPath, baseBranch)) {
    const detected = detectBaseBranch(repoAbsPath);
    if (detected !== baseBranch) {
      emitStatus(
        `Declared base branch origin/${baseBranch} not found; using detected default branch ${detected}`,
      );
      baseBranch = detected;
    }
  }
  emitStatus(`Base branch: ${baseBranch}`);

  // Create worktree — use absolute path so git -C doesn't resolve it
  // relative to the repository directory
  const worktreePath = path.resolve(path.join(wsPath, repoPathInput));
  mkdirSync(path.dirname(worktreePath), { recursive: true });

  let branchName: string;

  if (checkoutBranch) {
    // --- Checkout existing remote branch (PR-based setup) ---

    // If the target directory already exists, remove it
    if (existsSync(worktreePath)) {
      emitStatus(`Target directory already exists, removing: ${repoPathInput}`);
      rmSync(worktreePath, { recursive: true, force: true });
      try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
    }

    // Check if the local branch is already used by another worktree.
    // If so, create a worktree with a suffixed local branch name that tracks the same remote.
    let localBranchName = checkoutBranch;
    try {
      const worktreeList = exec(`git -C "${repoAbsPath}" worktree list --porcelain`);
      const isInUse = worktreeList
        .split("\n")
        .some((line) => line === `branch refs/heads/${checkoutBranch}`);
      if (isInUse) {
        let suffix = 2;
        while (
          worktreeList.split("\n").some((line) => line === `branch refs/heads/${checkoutBranch}-${suffix}`)
        ) {
          suffix++;
        }
        localBranchName = `${checkoutBranch}-${suffix}`;
        emitStatus(`Branch ${checkoutBranch} in use by another worktree, using local name ${localBranchName}`);
      }
    } catch { /* worktree list failed — proceed and let git error if needed */ }

    emitStatus(`Creating worktree: checking out existing branch ${checkoutBranch}`);
    exec(
      `git -C "${repoAbsPath}" worktree add -b "${localBranchName}" "${worktreePath}" "origin/${checkoutBranch}"`,
    );
    // Set up tracking so push/pull work against the original remote branch
    exec(
      `git -C "${worktreePath}" branch --set-upstream-to="origin/${checkoutBranch}"`,
    );
    branchName = localBranchName;
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

    // If the branch already exists (locally or on remote), always use a new name
    // to avoid inheriting commits from the existing branch.
    {
      const branchExists = (name: string): boolean => {
        try { exec(`git -C "${repoAbsPath}" rev-parse --verify "${name}"`); return true; } catch { /* noop */ }
        try { exec(`git -C "${repoAbsPath}" rev-parse --verify "origin/${name}"`); return true; } catch { /* noop */ }
        return false;
      };

      if (branchExists(branchName)) {
        const origName = branchName;
        let suffix = 2;
        while (suffix <= MAX_BRANCH_NAME_ATTEMPTS && branchExists(`${origName}-${suffix}`)) {
          suffix++;
        }
        if (suffix > MAX_BRANCH_NAME_ATTEMPTS) {
          // A timestamp needs no probe to be unused, and the point of the search
          // was only ever a fresh name. If this one is somehow taken as well,
          // `worktree add -b` refuses it and says so — git is the authority here,
          // not the probe that just claimed a hundred names in a row.
          branchName = `${origName}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
          emitStatus(
            `Warning: ${MAX_BRANCH_NAME_ATTEMPTS} names from ${origName} are all reported as taken, using ${branchName} instead.`,
          );
        } else {
          branchName = `${origName}-${suffix}`;
          emitStatus(`Branch ${origName} already exists, using ${branchName} instead.`);
        }
        try { exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
      }
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
