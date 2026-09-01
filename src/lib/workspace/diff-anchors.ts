/**
 * Where on a PR a review finding can be attached.
 *
 * GitHub only accepts an inline review comment whose line falls inside a diff
 * hunk; anything else comes back 422. That check is done here, against the same
 * three-dot diff GitHub computes, so the human ticking findings sees up front
 * which ones will land inline — a selection of six that returns four successes
 * and two rejections is the failure this exists to prevent.
 *
 * Ranges include **context** lines, not just changed ones, because GitHub's diff
 * carries three lines of context on each side and a comment on one of them is
 * accepted.
 */

import { execArgs } from "./helpers";
import type { FindingAnchor, ReviewFinding } from "@/types/review-findings";

/** Inclusive line range, 1-based. */
export interface LineRange {
  start: number;
  end: number;
}

/** One file's diff windows, per side. */
export interface FileHunks {
  /** Post-change line ranges (`side: RIGHT`). Empty for a deleted file. */
  right: LineRange[];
  /** Pre-change line ranges (`side: LEFT`). Empty for an added file. */
  left: LineRange[];
}

export type DiffHunks = Map<string, FileHunks>;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Strip git's `a/` / `b/` prefix and its C-style quoting.
 *
 * A path containing a space or a non-ASCII byte arrives quoted, and the quotes
 * are part of neither the prefix nor the path.
 */
function cleanPath(raw: string): string | null {
  let value = raw.trim();
  if (value === "/dev/null") return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    value = value.slice(1, -1);
  }
  if (value === "/dev/null") return null;
  if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2);
  return value === "" ? null : value;
}

/**
 * The diff windows of every file in a unified diff, keyed by path.
 *
 * A file is keyed by its post-change path, falling back to the pre-change one so
 * a deletion is still addressable (its LEFT side is real even though nothing can
 * be commented on its RIGHT).
 */
export function parseDiffHunks(diff: string): DiffHunks {
  const files: DiffHunks = new Map();
  let current: FileHunks | null = null;
  let oldPath: string | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = cleanPath(line.slice(4));
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const newPath = cleanPath(line.slice(4));
      const key = newPath ?? oldPath;
      if (key === null) {
        current = null;
        continue;
      }
      current = files.get(key) ?? { right: [], left: [] };
      files.set(key, current);
      continue;
    }

    if (!current || !line.startsWith("@@")) continue;
    const match = HUNK_HEADER.exec(line);
    if (!match) continue;

    // An omitted count means exactly one line; a count of 0 means the side does
    // not exist in this hunk (a pure addition has no pre-change lines).
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);

    if (oldCount > 0) current.left.push({ start: oldStart, end: oldStart + oldCount - 1 });
    if (newCount > 0) current.right.push({ start: newStart, end: newStart + newCount - 1 });
  }

  return files;
}

/**
 * The diff GitHub shows for the PR: three-dot against the base, so a base branch
 * that moved on does not turn other people's commits into this PR's changes.
 */
export function readPrDiff(worktreePath: string, baseRefName: string): string {
  return execArgs(
    ["git", "diff", "--unified=3", `origin/${baseRefName}...HEAD`],
    { cwd: worktreePath },
  );
}

/**
 * Decide how a finding can be attached, and say why when it cannot be inline.
 *
 * The three outcomes are the three things GitHub will accept: a line comment, a
 * file-level comment (which still requires the file to be in the diff), and the
 * review body. Nothing is dropped — a finding with no anchor at all still has
 * somewhere to go.
 */
export function resolveAnchor(
  finding: ReviewFinding,
  hunks: DiffHunks,
): { anchor: FindingAnchor; anchorReason: string | null } {
  const file = hunks.get(finding.path);
  if (!file) {
    return {
      anchor: "pr-body",
      anchorReason: `\`${finding.path}\` is not in the pull request diff`,
    };
  }

  if (finding.line === null) {
    return { anchor: "file", anchorReason: "the finding names no line" };
  }

  const ranges = finding.side === "LEFT" ? file.left : file.right;
  const contains = (n: number) => ranges.some((r) => n >= r.start && n <= r.end);

  // A startLine that is not strictly before the line is not a range — treat it
  // as a single-line comment rather than sending GitHub an inverted pair.
  const rangeStart =
    finding.startLine !== null && finding.startLine < finding.line ? finding.startLine : null;

  if (!contains(finding.line) || (rangeStart !== null && !contains(rangeStart))) {
    return {
      anchor: "file",
      anchorReason: `line ${finding.line} of \`${finding.path}\` is not part of the diff`,
    };
  }

  return { anchor: "inline", anchorReason: null };
}
