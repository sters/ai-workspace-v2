/**
 * Workspace helpers — shared utilities used by workspace modules.
 */

import { pathExists } from "@/lib/fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getResolvedWorkspaceRoot, getWorkspaceDir } from "../config";
import { runProcess } from "../process/run";
import type { StaleWorkspace, WorkspaceAgeInfo } from "@/types/workspace";

export async function exec(cmd: string, opts?: { cwd?: string }): Promise<string> {
  const result = await runProcess(["sh", "-c", cmd], {
    cwd: opts?.cwd ?? getResolvedWorkspaceRoot(),
  });
  if (!result.success) {
    throw new Error(result.stderr.trim() || `Command failed: ${cmd}`);
  }
  return result.stdout.trim();
}

/**
 * Run a command by spawning the binary directly (no shell), so callers don't
 * need to escape shell metacharacters in arguments. Prefer this over `exec`
 * when any argument originates from user-controlled input.
 */
export async function execArgs(args: string[], opts?: { cwd?: string }): Promise<string> {
  const result = await runProcess(args, {
    cwd: opts?.cwd ?? getResolvedWorkspaceRoot(),
  });
  if (!result.success) {
    throw new Error(result.stderr.trim() || `Command failed: ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

export function repoDir(): string {
  return path.join(getResolvedWorkspaceRoot(), "repositories");
}

/**
 * Re-exported so the many existing importers keep their path. It lives in
 * `@/lib/naming` because the quick-create form runs it in the browser, and
 * this module imports `node:fs`.
 */
export { sanitizeSlug } from "@/lib/naming";

// ---------------------------------------------------------------------------
// Staleness utilities
// ---------------------------------------------------------------------------

export async function listStaleWorkspaces(days: number): Promise<StaleWorkspace[]> {
  if (!(await pathExists(getWorkspaceDir()))) return [];

  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = await readdir(getWorkspaceDir(), { withFileTypes: true });
  const stale: StaleWorkspace[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const st = await stat(wsPath);
    if (st.mtime.getTime() < threshold) {
      stale.push({ name: entry.name, lastModified: st.mtime });
    }
  }

  return stale.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}

// ---------------------------------------------------------------------------
// Git branch detection
// ---------------------------------------------------------------------------

/**
 * Whether `origin/<branch>` exists as a remote-tracking ref in the repo.
 * Used to validate a declared/override base branch before it's handed to
 * `git worktree add`, which fails hard on a missing ref.
 */
export async function remoteBranchExists(repoAbsPath: string, branch: string): Promise<boolean> {
  try {
    await exec(
      `git -C "${repoAbsPath}" show-ref --verify --quiet "refs/remotes/origin/${branch}"`,
    );
    return true;
  } catch {
    return false;
  }
}

const COMMON_BASE_BRANCHES = ["main", "master", "develop", "development"];

/**
 * The base branch as the refs already on disk report it, with no network call.
 *
 * This answers a *display* question: the repository picker and the Changes tab
 * run it once per repository on every page load. `detectBaseBranch` answers
 * the question `git worktree add` is about to be held to — it may run `remote
 * set-head --auto`, which talks to the remote, and it throws when it cannot
 * decide. Creation still goes through that one; an empty string here only
 * means the caller has nothing to show.
 */
export async function localBaseBranch(repoAbsPath: string): Promise<string> {
  try {
    const ref = await exec(`git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`);
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* fall through to the common names */ }

  for (const branch of COMMON_BASE_BRANCHES) {
    try {
      await exec(`git -C "${repoAbsPath}" show-ref --verify --quiet refs/remotes/origin/${branch}`);
      return branch;
    } catch { /* try the next one */ }
  }
  return "";
}

export async function detectBaseBranch(repoAbsPath: string): Promise<string> {
  // 1. symbolic-ref
  try {
    const ref = await exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 2. set-head --auto
  try {
    await exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    const ref = await exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 3. common branch names
  for (const b of ["main", "master", "develop", "development"]) {
    try {
      await exec(
        `git -C "${repoAbsPath}" show-ref --verify --quiet refs/remotes/origin/${b}`,
      );
      return b;
    } catch { /* continue */ }
  }

  // 4. current branch
  try {
    const current = await exec(`git -C "${repoAbsPath}" rev-parse --abbrev-ref HEAD`);
    if (current && current !== "HEAD") return current;
  } catch { /* continue */ }

  throw new Error(`Could not determine base branch for ${repoAbsPath}`);
}

export async function listAllWorkspacesWithAge(staleDays: number): Promise<WorkspaceAgeInfo[]> {
  if (!(await pathExists(getWorkspaceDir()))) return [];

  const now = Date.now();
  const entries = await readdir(getWorkspaceDir(), { withFileTypes: true });
  const result: WorkspaceAgeInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const st = await stat(wsPath);
    const ageDays = Math.floor((now - st.mtime.getTime()) / (24 * 60 * 60 * 1000));
    result.push({
      name: entry.name,
      lastModified: st.mtime,
      ageDays,
      isStale: ageDays >= staleDays,
    });
  }

  return result.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}
