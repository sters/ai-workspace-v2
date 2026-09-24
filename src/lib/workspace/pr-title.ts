/**
 * The title a new pull request carries.
 *
 * The `create-pr` children run in parallel and each sees only its own
 * repository's diff, so nothing inside them can align the sibling PRs of one
 * task — the title has to be decided here and handed to every child verbatim.
 *
 * Each rule below has one right answer, which is why this is TypeScript rather
 * than another paragraph of the agent's prompt: an instruction to go and read
 * the ticket ID, or to count the branch's commits, is followed on some runs and
 * not on others, and that is the variance this exists to remove.
 *
 * The one git read goes through an injected seam (`GitExec`) so the rules are
 * unit-testable without a repository.
 */

import { getCleanEnv } from "../env";

export type GitExec = (args: string[], cwd: string) => { ok: boolean; out: string };

function runGit(args: string[], cwd: string): { ok: boolean; out: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: getCleanEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
}

/** Headings that mean nobody wrote one — the template's own, and `parseReadmeMeta`'s absence marker. */
const PLACEHOLDER_TITLE = /^(TBD|Untitled)$/i;

/**
 * The workspace's task title, or `null` when the README has none worth using.
 *
 * Placeholders are rejected rather than mandated: a README that `init-readme`
 * never rewrote (hand-edited, or `init --only`) still carries the template's
 * `TBD`, and `parseReadmeMeta` reports a missing heading as `Untitled`.
 */
export function resolveTaskTitle(title: string): string | null {
  const trimmed = title.trim().replace(/^Task:\s*/i, "").trim();
  if (!trimmed || PLACEHOLDER_TITLE.test(trimmed)) return null;
  return trimmed;
}

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

/** `Summary` → `[ABC-123] Summary`, when there is a ticket and the title does not already name it. */
export function applyTicketPrefix(title: string, ticketId: string | undefined): string {
  const id = (ticketId ?? "").trim().replace(/[.,;:]+$/, "");
  if (!id || !TICKET_ID_SHAPES.some((shape) => shape.test(id))) return title;
  if (title.toLowerCase().includes(id.toLowerCase())) return title;
  return `[${id}] ${title}`;
}

/** A commit subject that records a checkpoint rather than the change. */
const CHECKPOINT_SUBJECT = /^(wip\b|\[wip\]|fixup!|squash!|amend!|tmp\b|temp\b)/i;

/**
 * The subject of the branch's only commit, or `null` when the branch holds any
 * other number of them. A single commit's subject already describes the whole
 * change, so it beats having the agent compose a second description of it.
 */
export function getSoleCommitSubject(
  worktreePath: string,
  baseBranch: string,
  git: GitExec = runGit,
): string | null {
  const result = git(["log", "--format=%s", `origin/${baseBranch}..HEAD`], worktreePath);
  if (!result.ok) return null;

  const subjects = result.out.split("\n").map((line) => line.trim()).filter(Boolean);
  if (subjects.length !== 1) return null;

  const subject = subjects[0];
  return CHECKPOINT_SUBJECT.test(subject) ? null : subject;
}

/**
 * The title to mandate, or `null` to leave the agent composing one.
 *
 * The task title comes first because it is the only candidate that is the same
 * for every repository of the task; a sole commit subject is per-repo, so it is
 * reached only where there is no task title to align them anyway.
 */
export function resolvePrTitle(input: {
  taskTitle: string | null;
  ticketId: string | undefined;
  soleCommitSubject: string | null;
}): string | null {
  const base = input.taskTitle ?? input.soleCommitSubject;
  if (!base) return null;
  return applyTicketPrefix(base, input.ticketId);
}
