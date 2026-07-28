/**
 * Per-review-session record of what each repository's HEAD was when the review
 * ran, so the next review can scope itself to what changed since.
 *
 * Without it every cycle re-reviews `origin/<base>...HEAD` — the whole branch —
 * with a reviewer spawned fresh each time. On a long-lived branch that means a
 * narrow follow-up run (say, "address the PR review comments") gets a full
 * re-review of every commit, surfaces defects in code the run never touched, and
 * the gate's Must/Should-Fix audit turns each one into another cycle.
 *
 * Stored next to the review's markdown rather than in SQLite: review sessions are
 * read from disk by `listReviewSessions`, so keeping the baseline there leaves a
 * session self-describing and survives a DB reset.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { execArgs } from "./helpers";

export const BASELINE_FILENAME = "baseline.json";

export interface ReviewBaseline {
  /** HEAD sha per repo at review start, keyed by `repoName`. */
  heads: Record<string, string>;
}

function reviewsDirPath(wsPath: string): string {
  return path.join(wsPath, "artifacts", "reviews");
}

/** Resolve a worktree's current HEAD, or null when it isn't a readable repo. */
export function captureRepoHead(worktreePath: string): string | null {
  try {
    const sha = execArgs(["git", "-C", worktreePath, "rev-parse", "HEAD"]);
    return sha.trim() || null;
  } catch {
    return null;
  }
}

export async function writeReviewBaseline(
  wsPath: string,
  reviewTimestamp: string,
  heads: Record<string, string>,
): Promise<void> {
  const file = path.join(reviewsDirPath(wsPath), reviewTimestamp, BASELINE_FILENAME);
  const baseline: ReviewBaseline = { heads };
  await Bun.write(file, JSON.stringify(baseline, null, 2));
}

/**
 * Newest baseline strictly older than `beforeTimestamp`.
 *
 * Strictly older matters: `prepareReviewDir` has already created the current
 * session's directory by the time this is read, so including it would make a
 * review its own baseline and leave an empty review target. Session directory
 * names are `YYYYMMDD-HHMMSS`, so lexical ordering is chronological.
 *
 * Returns null when no prior session recorded one — every session predating this
 * feature, which is what makes a full-branch review the fallback rather than an
 * error.
 */
export async function readPreviousReviewBaseline(
  wsPath: string,
  beforeTimestamp: string,
): Promise<{ timestamp: string; heads: Record<string, string> } | null> {
  const reviewsDir = reviewsDirPath(wsPath);
  if (!existsSync(reviewsDir)) return null;

  let candidates: string[];
  try {
    candidates = readdirSync(reviewsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name < beforeTimestamp)
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return null;
  }

  for (const timestamp of candidates) {
    const file = Bun.file(path.join(reviewsDir, timestamp, BASELINE_FILENAME));
    if (!(await file.exists())) continue;
    try {
      const parsed = JSON.parse(await file.text()) as ReviewBaseline;
      const heads = parsed?.heads;
      if (!heads || typeof heads !== "object") continue;
      const entries = Object.entries(heads).filter(
        ([, sha]) => typeof sha === "string" && sha.trim() !== "",
      );
      if (entries.length === 0) continue;
      return { timestamp, heads: Object.fromEntries(entries) };
    } catch {
      // Unreadable baseline — fall through to an older session rather than
      // giving up, since a full re-review is the expensive outcome here.
      continue;
    }
  }

  return null;
}
