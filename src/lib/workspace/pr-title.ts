/**
 * The parts of a new pull request's title that have one right answer.
 *
 * A title describes what that PR changes, so it is composed per repository from
 * its own diff — never taken from the workspace's task heading, which names the
 * task rather than any one PR. What is derived here is only what an agent would
 * get right on some runs and not on others: the ticket reference, and the case
 * where the branch's single commit already states the change.
 *
 * The one git read goes through an injected seam (`GitExec`) so the rules are
 * unit-testable without a repository.
 */

import { runGit, type GitExec } from "./git-exec";

export type { GitExec };


/**
 * Ticket references that may be bracketed onto a title. `**Ticket ID**:` is read
 * as one whitespace-delimited token, so the field also arrives holding a URL,
 * `N/A` or a prose answer — anything not shaped like an ID is left out rather
 * than put on every PR of the task.
 */
const TICKET_ID_SHAPES = [
  /^[A-Za-z][A-Za-z0-9]*-\d+$/, // Jira, Linear: ABC-123
  /^#\d+$/, // GitHub issue: #42
  /^[\w.-]+\/[\w.-]+#\d+$/, // GitHub cross-repo: acme/web#42
];

/** The README's `**Ticket ID**` when it is shaped like one, or `null`. */
export function resolveTicketRef(ticketId: string | undefined): string | null {
  const id = (ticketId ?? "").trim().replace(/[.,;:]+$/, "");
  if (!id || !TICKET_ID_SHAPES.some((shape) => shape.test(id))) return null;
  return id;
}

/**
 * `Summary` → `[ABC-123] Summary`: every PR title of a ticketed task has this one
 * shape. A ticket the title already leads with in another shape (`ABC-123:`,
 * `(ABC-123)`, …) is rewritten into it rather than bracketed on a second time.
 */
export function applyTicketPrefix(title: string, ticketId: string | undefined): string {
  const id = resolveTicketRef(ticketId);
  if (!id) return title;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leading = new RegExp(`^\\s*[[(]?${escaped}(?![\\w-])[\\])]?\\s*[:|\\-–—]?\\s*`, "i");
  return `[${id}] ${title.replace(leading, "")}`;
}

/** A commit subject that records a checkpoint rather than the change. */
const CHECKPOINT_SUBJECT = /^(wip\b|\[wip\]|fixup!|squash!|amend!|tmp\b|temp\b)/i;

/**
 * The subject of the branch's only commit, or `null` when the branch holds any
 * other number of them. A single commit's subject already describes the whole
 * change, so it beats having the agent compose a second description of it.
 */
export async function getSoleCommitSubject(
  worktreePath: string,
  baseBranch: string,
  git: GitExec = runGit,
): Promise<string | null> {
  const result = await git(["log", "--format=%s", `origin/${baseBranch}..HEAD`], worktreePath);
  if (!result.ok) return null;

  const subjects = result.out.split("\n").map((line) => line.trim()).filter(Boolean);
  if (subjects.length !== 1) return null;

  const subject = subjects[0];
  return CHECKPOINT_SUBJECT.test(subject) ? null : subject;
}

/** The title to mandate, or `null` to have the agent compose one from the diff. */
export function resolvePrTitle(input: {
  ticketId: string | undefined;
  soleCommitSubject: string | null;
}): string | null {
  if (!input.soleCommitSubject) return null;
  return applyTicketPrefix(input.soleCommitSubject, input.ticketId);
}
