/**
 * Comments left on lines of the Changes tab's diffs, and what they become when
 * handed over: the opening message of a chat, or a TODO instruction
 * (`buildChangeCommentsTodoInstruction`).
 */

import { describeLineRange, type DiffLine, type LineRangeDescription } from "@/lib/unified-diff";

export interface ChangeComment extends LineRangeDescription {
  id: string;
  /** The worktree, relative to the workspace directory. */
  repoPath: string;
  /** The worktree directory name, which names its `TODO-<repoName>.md`. */
  repoName: string;
  /** Relative to the worktree. */
  filePath: string;
  /** What the user wrote about the lines; empty when they only marked them. */
  comment: string;
}

function lines([start, end]: [number, number]): string {
  return start === end ? `line ${start}` : `lines ${start}-${end}`;
}

export function describeRange(range: Pick<LineRangeDescription, "oldRange" | "newRange">): string {
  if (range.newRange) return lines(range.newRange);
  if (range.oldRange) return `removed ${lines(range.oldRange)} of the base version`;
  return "";
}

export function locateComment(comment: ChangeComment): string {
  const where = `${comment.repoPath}/${comment.filePath}`;
  const range = describeRange(comment);
  return range ? `${where}, ${range}` : where;
}

/** A fence longer than any backtick run in the quoted text, so it cannot close early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function quoteDiff(text: string): string {
  const fence = fenceFor(text);
  return `${fence}diff\n${text}\n${fence}`;
}

/** The opening message of a discussion chat about these comments. */
export function buildCommentsTopic(comments: ChangeComment[]): string {
  const parts = comments.map((c, i) => {
    const said = c.comment.trim();
    return [`${i + 1}. ${locateComment(c)}`, quoteDiff(c.text), ...(said ? [`My comment: ${said}`] : [])].join(
      "\n",
    );
  });
  return [
    "About these parts of this workspace's changes (each worktree diffed against its base branch; paths are relative to the workspace directory):",
    "",
    parts.join("\n\n"),
  ].join("\n");
}

/**
 * The editor lines (1-based, inclusive) a comment sits on in this diff, or
 * `null` when no run of lines numbers and reads the same as when it was made —
 * the file has changed under it since, and placing it would put the comment on
 * code it was not written about.
 */
export function anchorComment(
  diffLines: DiffLine[],
  range: LineRangeDescription,
): { fromLine: number; toLine: number } | null {
  if (!range.oldRange && !range.newRange) return null;
  const count = range.text.split("\n").length;
  const sameSide = (a: [number, number] | null, b: [number, number] | null) =>
    a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

  for (let fromLine = 1; fromLine + count - 1 <= diffLines.length; fromLine++) {
    const toLine = fromLine + count - 1;
    const here = describeLineRange(diffLines, fromLine, toLine);
    if (
      here.text === range.text &&
      sameSide(here.oldRange, range.oldRange) &&
      sameSide(here.newRange, range.newRange)
    ) {
      return { fromLine, toLine };
    }
  }
  return null;
}

function storageKey(workspaceId: string): string {
  return `aiw-change-comments:${workspaceId}`;
}

function isChangeComment(value: unknown): value is ChangeComment {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["id", "repoPath", "repoName", "filePath", "text", "comment"].every(
    (key) => typeof v[key] === "string",
  );
}

/** The comments survive switching tabs, not closing the browser tab. */
export function loadChangeComments(workspaceId: string): ChangeComment[] {
  try {
    const raw = sessionStorage.getItem(storageKey(workspaceId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isChangeComment) : [];
  } catch {
    return [];
  }
}

export function saveChangeComments(workspaceId: string, comments: ChangeComment[]): void {
  try {
    if (comments.length === 0) sessionStorage.removeItem(storageKey(workspaceId));
    else sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(comments));
  } catch {
    // the comments just do not outlive the page
  }
}
