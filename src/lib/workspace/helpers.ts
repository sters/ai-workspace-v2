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

export function repoDir(): string {
  return path.join(getResolvedWorkspaceRoot(), "repositories");
}

/**
 * Convert any input string to a filesystem-safe ASCII slug.
 * - Replaces non-ASCII characters, spaces, and special chars with hyphens
 * - Collapses multiple hyphens
 * - Trims hyphens from start/end
 * - Lowercases everything
 * - Truncates to maxLength (default 50)
 * - Falls back to "workspace" if result is empty (e.g., pure non-ASCII input)
 */
export function sanitizeSlug(input: string, maxLength = 50): string {
  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")  // Replace non-ASCII, spaces, special chars with hyphens
    .replace(/-+/g, "-")          // Collapse multiple hyphens
    .replace(/^-+|-+$/g, "");     // Trim leading/trailing hyphens

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, ""); // Trim trailing hyphens from truncation
  }

  return slug || "workspace";
}

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
