/**
 * Repository prune — what is cloned under `repositories/`, when the tooling
 * last touched it, and whether anything still depends on it.
 *
 * Deleting a clone is the one destructive thing on this path, so the check is
 * deterministic and fails closed: a clone whose worktree list cannot be read is
 * refused rather than assumed unused. Nothing here calls a model.
 *
 * Usage is read out of git's own worktree registrations, because that is what
 * `setupRepository` writes and the only thing that makes a workspace's
 * directory a working checkout. A workspace README that *declares* a repository
 * without a worktree is deliberately not usage — deleting the clone costs that
 * workspace a re-clone, not its work.
 */

import { existsSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { execArgs, repoDir } from "./helpers";
import { listAllRepositories } from "./git";
import type {
  RepositoryPruneCandidate,
  RepositoryPruneOutcome,
  RepositoryUsage,
} from "@/types/repository-prune";

/**
 * Signals inside the clone that the tooling moves, newest wins. `FETCH_HEAD` is
 * rewritten by the fetch every `setupRepository` runs, and `worktrees/` changes
 * whenever a worktree is added or pruned. The clone directory's own mtime is
 * the floor: it is the clone date, and nothing afterwards moves it.
 */
const REFERENCE_SIGNALS = ["", ".git", path.join(".git", "FETCH_HEAD"), path.join(".git", "worktrees")];

function realPathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** When the tooling last touched this clone. */
export function lastReferencedAt(repoAbsPath: string): Date {
  let newest = 0;
  for (const signal of REFERENCE_SIGNALS) {
    try {
      const mtime = statSync(path.join(repoAbsPath, signal)).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch {
      // A signal a clone never produced says nothing about when it was used.
    }
  }
  return new Date(newest);
}

/** The first path segment under `workspace/`, or `""` for a worktree elsewhere. */
function workspaceOf(worktreePath: string, workspaceDir: string): string {
  if (!isInside(workspaceDir, worktreePath)) return "";
  return path.relative(workspaceDir, worktreePath).split(path.sep)[0];
}

/**
 * The worktrees of this clone that exist on disk.
 *
 * Throws when git cannot list them — the caller must not read that as "unused".
 * A registration whose directory is gone is `git worktree prune` territory, not
 * usage.
 */
export function listRepositoryUsage(repoPath: string): RepositoryUsage[] {
  const repoAbsPath = path.join(repoDir(), repoPath);
  const listing = execArgs(["git", "-C", repoAbsPath, "worktree", "list", "--porcelain"]);
  const mainWorktree = realPathOrSelf(repoAbsPath);
  const workspaceDir = realPathOrSelf(getWorkspaceDir());

  const usage: RepositoryUsage[] = [];
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const worktreePath = line.slice("worktree ".length).trim();
    if (!worktreePath) continue;
    const resolved = realPathOrSelf(worktreePath);
    if (resolved === mainWorktree) continue;
    if (!existsSync(worktreePath)) continue;
    // The resolved path, so the reported location and the workspace derived
    // from it are the same string git and the filesystem agree on.
    usage.push({ workspace: workspaceOf(resolved, workspaceDir), worktreePath: resolved });
  }
  return usage;
}

/** Every clone under `repositories/`, least recently referenced first. */
export function listRepositoryPruneCandidates(): RepositoryPruneCandidate[] {
  const candidates = listAllRepositories().map((repo) => {
    const repoAbsPath = path.join(repoDir(), repo.repoPath);
    let usedBy: RepositoryUsage[] = [];
    let usageError: string | undefined;
    try {
      usedBy = listRepositoryUsage(repo.repoPath);
    } catch (err) {
      usageError = err instanceof Error ? err.message : String(err);
    }
    return {
      repoPath: repo.repoPath,
      repoName: repo.repoName,
      lastReferencedAt: lastReferencedAt(repoAbsPath).toISOString(),
      usedBy,
      ...(usageError ? { usageError } : {}),
    };
  });

  return candidates.sort((a, b) => a.lastReferencedAt.localeCompare(b.lastReferencedAt));
}

/**
 * Delete the org directories a deletion emptied, so the tree does not fill with
 * `github.com/<org>` shells. Stops at the first directory still holding
 * anything, and never at or above `repositories/` itself.
 */
function removeEmptiedParents(from: string, base: string): void {
  let current = from;
  while (isInside(base, current)) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function refuse(repoPath: string, reason: string): RepositoryPruneOutcome {
  return { repoPath, deleted: false, reason };
}

/**
 * Delete each named clone, provided nothing uses it. Every request is settled
 * on its own — a refusal reports its reason and the rest still run.
 *
 * Usage is re-checked here rather than trusted from the listing the caller
 * ticked: a workspace may have been created since it was read.
 */
export function pruneRepositories(repoPaths: string[]): RepositoryPruneOutcome[] {
  const base = repoDir();
  const resolvedBase = realPathOrSelf(base);

  return repoPaths.map((repoPath) => {
    const repoAbsPath = path.resolve(base, repoPath);
    if (!isInside(base, repoAbsPath) || !isInside(resolvedBase, realPathOrSelf(repoAbsPath))) {
      return refuse(repoPath, "Not a path inside repositories/.");
    }
    if (!existsSync(repoAbsPath)) {
      return refuse(repoPath, "Not found under repositories/.");
    }
    if (!existsSync(path.join(repoAbsPath, ".git"))) {
      return refuse(repoPath, "Not a git repository.");
    }

    let usedBy: RepositoryUsage[];
    try {
      // The validated path, so the clone whose worktrees decide this is the
      // one the deletion below is aimed at.
      usedBy = listRepositoryUsage(path.relative(base, repoAbsPath));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return refuse(repoPath, `Could not list its worktrees, so nothing confirms it is unused: ${reason}`);
    }
    if (usedBy.length > 0) {
      const holders = usedBy.map((u) => u.workspace || u.worktreePath).join(", ");
      return refuse(repoPath, `In use by ${usedBy.length} worktree(s): ${holders}.`);
    }

    try {
      rmSync(repoAbsPath, { recursive: true, force: true });
    } catch (err) {
      return refuse(repoPath, err instanceof Error ? err.message : String(err));
    }
    removeEmptiedParents(path.dirname(repoAbsPath), base);
    return { repoPath, deleted: true };
  });
}
