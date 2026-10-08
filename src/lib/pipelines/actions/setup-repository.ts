/**
 * Pipeline action: set up a git worktree for a repository within a workspace.
 * Handles cloning, fetching, branch creation, worktree setup, and conflict resolution.
 */

import { pathExists } from "@/lib/fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { dateStamp, deriveBranchName } from "@/lib/naming";
import { exec, repoDir, detectBaseBranch, remoteBranchExists } from "@/lib/workspace/helpers";
import { Semaphore } from "@/lib/semaphore";
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
async function fetchAllWithRetries(
  repoAbsPath: string,
  emitStatus: (message: string) => void,
): Promise<boolean> {
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await exec(`git -C "${repoAbsPath}" fetch --all --prune`);
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
      await Bun.sleep(delay);
    }
  }
  return false;
}

/**
 * How many worktrees are checked out at once by `setupRepositories`. The
 * checkout is disk-bound, so past a few in flight they only slow each other.
 */
const WORKTREE_CHECKOUT_CONCURRENCY = 4;

const g = globalThis as unknown as { __aiwCloneLocks?: Map<string, Promise<unknown>> };

/**
 * Serializes the steps that write a clone's shared metadata. Creating a branch
 * whose start point is a remote branch records its upstream in `.git/config`,
 * and two `worktree add -b` on one clone at once fail on that file's lock —
 * whether they come from one operation or two.
 */
async function withCloneLock<T>(repoAbsPath: string, fn: () => Promise<T>): Promise<T> {
  const locks = (g.__aiwCloneLocks ??= new Map());
  const previous = locks.get(repoAbsPath) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const settled = run.then(() => undefined, () => undefined);
  locks.set(repoAbsPath, settled);
  try {
    return await run;
  } finally {
    if (locks.get(repoAbsPath) === settled) locks.delete(repoAbsPath);
  }
}

interface ParsedRepoArg {
  /** Clone path under `repositories/`, without the alias. */
  actualRepoPath: string;
  repoAlias: string;
  /** Worktree directory under the workspace: `<path>___<alias>` when aliased. */
  repoPathInput: string;
}

/** Parse alias syntax (e.g. github.com/org/repo:dev). */
function parseRepoArg(repositoryPathArg: string): ParsedRepoArg {
  if (!repositoryPathArg.includes(":")) {
    return { actualRepoPath: repositoryPathArg, repoAlias: "", repoPathInput: repositoryPathArg };
  }
  const actualRepoPath = repositoryPathArg.split(":")[0];
  const repoAlias = repositoryPathArg.split(":").slice(1).join(":");
  return { actualRepoPath, repoAlias, repoPathInput: `${actualRepoPath}___${repoAlias}` };
}

async function requireWorkspaceDir(workspaceName: string): Promise<string> {
  const wsPath = path.join(getWorkspaceDir(), workspaceName);
  if (!(await pathExists(wsPath))) {
    throw new Error(`Workspace directory does not exist: ${wsPath}`);
  }
  return wsPath;
}

/** Clone the repository, or fetch it when it is already on disk. */
async function ensureLocalClone(
  actualRepoPath: string,
  emitStatus: (message: string) => void,
): Promise<void> {
  const repoAbsPath = path.join(repoDir(), actualRepoPath);
  if (!(await pathExists(repoAbsPath))) {
    emitStatus(`Repository not found locally, cloning ${actualRepoPath}...`);
    const parentDir = path.dirname(repoAbsPath);
    await mkdir(parentDir, { recursive: true });
    const repoUrl = `https://${actualRepoPath}.git`;
    await exec(`git clone "${repoUrl}" "${repoAbsPath}"`);
    emitStatus("Clone complete.");
  } else {
    emitStatus(`Repository found locally, fetching latest...`);
    await fetchAllWithRetries(repoAbsPath, emitStatus);
  }
  try {
    await exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
  } catch (err) { console.debug("[setup] set-head failed (non-critical):", err); }
}

/** Cut a worktree from a clone that is already on disk and current. */
async function createWorktree(
  workspaceName: string,
  wsPath: string,
  repositoryPathArg: string,
  baseBranchOverride: string | undefined,
  emitStatus: (message: string) => void,
  checkoutBranch?: string,
): Promise<SetupRepositoryResult> {
  const { actualRepoPath, repoAlias, repoPathInput } = parseRepoArg(repositoryPathArg);
  const repoName = path.basename(repoPathInput);
  const repoAbsPath = path.join(repoDir(), actualRepoPath);

  // Detect base branch. A README-declared override (e.g. `main`) may not match
  // the repo's actual default branch (e.g. `master`); trusting it blindly makes
  // the later `worktree add ... origin/<branch>` fail with `invalid reference`.
  // So if the override doesn't exist on the remote, fall back to the detected default.
  let baseBranch = baseBranchOverride ?? (await detectBaseBranch(repoAbsPath));
  if (baseBranchOverride && !(await remoteBranchExists(repoAbsPath, baseBranch))) {
    const detected = await detectBaseBranch(repoAbsPath);
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
  await mkdir(path.dirname(worktreePath), { recursive: true });

  // The worktree is registered without a checkout inside the clone lock, and
  // its files are checked out after it is released: the checkout is the slow
  // part and touches nothing the other worktrees share.
  const branchName = await withCloneLock(repoAbsPath, async () => {
    if (checkoutBranch) {
      // --- Checkout existing remote branch (PR-based setup) ---

      // If the target directory already exists, remove it
      if (await pathExists(worktreePath)) {
        emitStatus(`Target directory already exists, removing: ${repoPathInput}`);
        await rm(worktreePath, { recursive: true, force: true });
        try { await exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
      }

      // Check if the local branch is already used by another worktree.
      // If so, create a worktree with a suffixed local branch name that tracks the same remote.
      let localBranchName = checkoutBranch;
      try {
        const worktreeList = await exec(`git -C "${repoAbsPath}" worktree list --porcelain`);
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
      await exec(
        `git -C "${repoAbsPath}" worktree add --no-checkout -b "${localBranchName}" "${worktreePath}" "origin/${checkoutBranch}"`,
      );
      // Set up tracking so push/pull work against the original remote branch
      await exec(
        `git -C "${worktreePath}" branch --set-upstream-to="origin/${checkoutBranch}"`,
      );
      return localBranchName;
    }

    // --- Create new branch (default behavior) ---

    let newBranch = deriveBranchName(workspaceName, repoAlias, dateStamp(new Date()));

    // If the branch already exists (locally or on remote), always use a new name
    // to avoid inheriting commits from the existing branch.
    const branchExists = async (name: string): Promise<boolean> => {
      try { await exec(`git -C "${repoAbsPath}" rev-parse --verify "${name}"`); return true; } catch { /* noop */ }
      try { await exec(`git -C "${repoAbsPath}" rev-parse --verify "origin/${name}"`); return true; } catch { /* noop */ }
      return false;
    };

    if (await branchExists(newBranch)) {
      const origName = newBranch;
      let suffix = 2;
      while (suffix <= MAX_BRANCH_NAME_ATTEMPTS && (await branchExists(`${origName}-${suffix}`))) {
        suffix++;
      }
      if (suffix > MAX_BRANCH_NAME_ATTEMPTS) {
        // A timestamp needs no probe to be unused, and the point of the search
        // was only ever a fresh name. If this one is somehow taken as well,
        // `worktree add -b` refuses it and says so — git is the authority here,
        // not the probe that just claimed a hundred names in a row.
        newBranch = `${origName}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
        emitStatus(
          `Warning: ${MAX_BRANCH_NAME_ATTEMPTS} names from ${origName} are all reported as taken, using ${newBranch} instead.`,
        );
      } else {
        newBranch = `${origName}-${suffix}`;
        emitStatus(`Branch ${origName} already exists, using ${newBranch} instead.`);
      }
      try { await exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
    }

    // If the target directory already exists (e.g. from a previous failed attempt),
    // remove it before creating the worktree
    if (await pathExists(worktreePath)) {
      emitStatus(`Target directory already exists, removing: ${repoPathInput}`);
      await rm(worktreePath, { recursive: true, force: true });
      try { await exec(`git -C "${repoAbsPath}" worktree prune`); } catch { /* ignore */ }
    }

    emitStatus(`Creating worktree: branch ${newBranch} from origin/${baseBranch}`);
    const worktreeOutput = await exec(
      `git -C "${repoAbsPath}" worktree add --no-checkout -b "${newBranch}" "${worktreePath}" "origin/${baseBranch}"`,
    );
    if (worktreeOutput) {
      emitStatus(`git worktree add: ${worktreeOutput}`);
    }
    return newBranch;
  });

  // Verify the worktree was actually created
  if (!(await pathExists(path.join(worktreePath, ".git")))) {
    // Log diagnostic info
    const list = await exec(`git -C "${repoAbsPath}" worktree list`);
    emitStatus(`Worktree list after add: ${list}`);
    throw new Error(
      `git worktree add returned successfully but ${worktreePath}/.git does not exist. ` +
      `repoAbsPath=${repoAbsPath}, branchName=${branchName}, baseBranch=origin/${baseBranch}`,
    );
  }

  const checkoutOutput = await exec(`git -C "${worktreePath}" reset --hard`);
  if (checkoutOutput) {
    emitStatus(`git checkout: ${checkoutOutput}`);
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

export async function setupRepository(
  workspaceName: string,
  repositoryPathArg: string,
  baseBranchOverride: string | undefined,
  emitStatus: (message: string) => void,
  checkoutBranch?: string,
): Promise<SetupRepositoryResult> {
  const wsPath = await requireWorkspaceDir(workspaceName);
  await ensureLocalClone(parseRepoArg(repositoryPathArg).actualRepoPath, emitStatus);
  return createWorktree(workspaceName, wsPath, repositoryPathArg, baseBranchOverride, emitStatus, checkoutBranch);
}

export interface RepositorySetupRequest {
  /** Repository path, with an optional `:alias` suffix. */
  repoPath: string;
  baseBranchOverride?: string;
  checkoutBranch?: string;
}

export type RepositorySetupOutcome =
  | { repoPath: string; ok: true; result: SetupRepositoryResult }
  | { repoPath: string; ok: false; error: unknown };

/**
 * Set up several worktrees at once. Each clone is cloned or fetched once
 * however many worktrees are cut from it, and the worktrees are checked out
 * concurrently. One failing does not stop the others: each request gets an
 * outcome, in input order, and the caller decides what a failure means.
 */
export async function setupRepositories(
  workspaceName: string,
  requests: RepositorySetupRequest[],
  emitStatus: (message: string) => void,
  options: { signal?: AbortSignal } = {},
): Promise<RepositorySetupOutcome[]> {
  const wsPath = await requireWorkspaceDir(workspaceName);

  const clones = [...new Set(requests.map((r) => parseRepoArg(r.repoPath).actualRepoPath))];
  const cloneErrors = new Map<string, unknown>();
  await Promise.all(
    clones.map(async (clone) => {
      try {
        await ensureLocalClone(clone, (m) => emitStatus(`[${clone}] ${m}`));
      } catch (err) {
        cloneErrors.set(clone, err);
      }
    }),
  );

  const semaphore = new Semaphore(WORKTREE_CHECKOUT_CONCURRENCY);
  return Promise.all(
    requests.map((req) =>
      semaphore.run(async (): Promise<RepositorySetupOutcome> => {
        const { repoPath } = req;
        const clone = parseRepoArg(repoPath).actualRepoPath;
        if (cloneErrors.has(clone)) {
          return { repoPath, ok: false, error: cloneErrors.get(clone) };
        }
        if (options.signal?.aborted) {
          return { repoPath, ok: false, error: new Error("Setup was interrupted") };
        }
        emitStatus(`Setting up repository: ${repoPath}`);
        try {
          const result = await createWorktree(
            workspaceName,
            wsPath,
            repoPath,
            req.baseBranchOverride,
            (m) => emitStatus(`[${repoPath}] ${m}`),
            req.checkoutBranch,
          );
          return { repoPath, ok: true, result };
        } catch (error) {
          return { repoPath, ok: false, error };
        }
      }),
    ),
  );
}
