/**
 * Workspace helpers — shared utilities used by workspace modules.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AI_WORKSPACE_ROOT, WORKSPACE_DIR } from "../config";

export function exec(cmd: string, opts?: { cwd?: string; maxBuffer?: number }): string {
  const result = Bun.spawnSync(["sh", "-c", cmd], {
    cwd: opts?.cwd ?? AI_WORKSPACE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr || `Command failed: ${cmd}`);
  }
  return result.stdout.toString().trim();
}

export function repoDir(): string {
  return path.join(AI_WORKSPACE_ROOT, "repositories");
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

export interface StaleWorkspace {
  name: string;
  lastModified: Date;
}

export function listStaleWorkspaces(days: number): StaleWorkspace[] {
  if (!existsSync(WORKSPACE_DIR)) return [];

  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = readdirSync(WORKSPACE_DIR, { withFileTypes: true });
  const stale: StaleWorkspace[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(WORKSPACE_DIR, entry.name);
    const stat = statSync(wsPath);
    if (stat.mtime.getTime() < threshold) {
      stale.push({ name: entry.name, lastModified: stat.mtime });
    }
  }

  return stale.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
}

export interface WorkspaceAgeInfo {
  name: string;
  lastModified: Date;
  ageDays: number;
  isStale: boolean;
}

export function listAllWorkspacesWithAge(staleDays: number): WorkspaceAgeInfo[] {
  if (!existsSync(WORKSPACE_DIR)) return [];

  const now = Date.now();
  const entries = readdirSync(WORKSPACE_DIR, { withFileTypes: true });
  const result: WorkspaceAgeInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wsPath = path.join(WORKSPACE_DIR, entry.name);
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
