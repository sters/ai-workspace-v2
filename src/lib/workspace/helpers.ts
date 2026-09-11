/**
 * Workspace helpers — shared utilities used by workspace modules.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getResolvedWorkspaceRoot, getWorkspaceDir } from "../config";
import { getCleanEnv } from "../env";
import type { StaleWorkspace, WorkspaceAgeInfo } from "@/types/workspace";

export function exec(cmd: string, opts?: { cwd?: string; maxBuffer?: number }): string {
  const result = Bun.spawnSync(["sh", "-c", cmd], {
    cwd: opts?.cwd ?? getResolvedWorkspaceRoot(),
    stdout: "pipe",
    stderr: "pipe",
    env: getCleanEnv(),
  });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `Command failed: ${cmd}`);
  }
  return result.stdout.toString().trim();
}

/**
 * Run a command by spawning the binary directly (no shell), so callers don't
 * need to escape shell metacharacters in arguments. Prefer this over `exec`
 * when any argument originates from user-controlled input.
 */
export function execArgs(args: string[], opts?: { cwd?: string }): string {
  const result = Bun.spawnSync(args, {
    cwd: opts?.cwd ?? getResolvedWorkspaceRoot(),
    stdout: "pipe",
    stderr: "pipe",
    env: getCleanEnv(),
  });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `Command failed: ${args.join(" ")}`);
  }
  return result.stdout.toString().trim();
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

export function listStaleWorkspaces(days: number): StaleWorkspace[] {
  if (!existsSync(getWorkspaceDir())) return [];

  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const stale: StaleWorkspace[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const stat = statSync(wsPath);
    if (stat.mtime.getTime() < threshold) {
      stale.push({ name: entry.name, lastModified: stat.mtime });
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
export function remoteBranchExists(repoAbsPath: string, branch: string): boolean {
  try {
    exec(
      `git -C "${repoAbsPath}" show-ref --verify --quiet "refs/remotes/origin/${branch}"`,
    );
    return true;
  } catch {
    return false;
  }
}

export function detectBaseBranch(repoAbsPath: string): string {
  // 1. symbolic-ref
  try {
    const ref = exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 2. set-head --auto
  try {
    exec(`git -C "${repoAbsPath}" remote set-head origin --auto`);
    const ref = exec(
      `git -C "${repoAbsPath}" symbolic-ref refs/remotes/origin/HEAD`,
    );
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch { /* continue */ }

  // 3. common branch names
  for (const b of ["main", "master", "develop", "development"]) {
    try {
      exec(
        `git -C "${repoAbsPath}" show-ref --verify --quiet refs/remotes/origin/${b}`,
      );
      return b;
    } catch { /* continue */ }
  }

  // 4. current branch
  try {
    const current = exec(`git -C "${repoAbsPath}" rev-parse --abbrev-ref HEAD`);
    if (current && current !== "HEAD") return current;
  } catch { /* continue */ }

  throw new Error(`Could not determine base branch for ${repoAbsPath}`);
}

export function listAllWorkspacesWithAge(staleDays: number): WorkspaceAgeInfo[] {
  if (!existsSync(getWorkspaceDir())) return [];

  const now = Date.now();
  const entries = readdirSync(getWorkspaceDir(), { withFileTypes: true });
  const result: WorkspaceAgeInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(getWorkspaceDir(), entry.name);
    const stat = statSync(wsPath);
    const ageDays = Math.floor((now - stat.mtime.getTime()) / (24 * 60 * 60 * 1000));
    result.push({
      name: entry.name,
      lastModified: stat.mtime,
      ageDays,
      isStale: ageDays >= staleDays,
    });
  }

  return result.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}
