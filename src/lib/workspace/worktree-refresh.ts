/**
 * Bringing a workspace worktree back up to the branch it tracks.
 *
 * A worktree is checked out once, when the workspace is created, and nothing
 * fetches it afterwards. For a workspace reviewing someone else's pull request
 * that makes a second review read the code as it was: the author pushes, the
 * PR moves, and the worktree stays where `setupRepository` left it. The stale
 * state is already *detected* elsewhere (`staleWorktree` on the findings target
 * PR) — this is the part that acts on it.
 *
 * Deliberately deterministic TypeScript rather than an agent instruction. There
 * is one right answer for each state, and a rebased branch needs
 * `git reset --hard`, which the managed `blockDangerousBash` hook stops an agent
 * from running at all.
 *
 * Every git call goes through one injected seam (`GitExec`) so the decision
 * table below is unit-testable without a repository. A call that fails yields
 * `ok: false` rather than throwing: most of the failures here are states to
 * report (no upstream, dirty tree), not exceptions.
 */

import { getCleanEnv } from "../env";

export type GitExec = (args: string[], cwd: string) => { ok: boolean; out: string };

export type WorktreeRefreshStatus =
  /** Already at the tracked branch's tip. */
  | "up-to-date"
  /** Moved forward; the old head is an ancestor. */
  | "fast-forwarded"
  /** Upstream was rewritten (force-push or rebase); the old head was discarded. */
  | "reset"
  /** Uncommitted changes — nothing was moved, since moving would discard them. */
  | "dirty"
  /** No tracked remote branch, or it no longer exists on the remote. */
  | "no-upstream"
  /** A git command failed. */
  | "failed";

export interface WorktreeRefreshResult {
  repoName: string;
  status: WorktreeRefreshStatus;
  /** HEAD before the refresh. Empty when it could not be read. */
  fromSha: string;
  /** HEAD after the refresh. Equals `fromSha` when nothing moved. */
  toSha: string;
  /** Tracked branch, e.g. `origin/feature-x`. Empty when there is none. */
  upstream: string;
  /** Ref holding the discarded head after a reset, so it stays recoverable. */
  backupRef?: string;
  /** One line for the operation log: what happened, or why nothing did. */
  detail: string;
}

/** Namespace for pre-reset heads. Outside `refs/heads` and `refs/tags`, so it shows up in neither listing. */
const BACKUP_REF_PREFIX = "refs/aiw-refresh-backup";

function runGit(args: string[], cwd: string): { ok: boolean; out: string } {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: getCleanEnv(),
  });
  const out = result.success
    ? result.stdout.toString().trim()
    : result.stderr.toString().trim();
  return { ok: result.success, out };
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Fast-forward one worktree onto the branch it tracks, resetting when the
 * remote was rewritten.
 *
 * Ordering is the substance of this function:
 *
 * - The **fetch failure is not fatal**. A locally known upstream ref can still
 *   be ahead of HEAD from an earlier fetch, and moving onto it is better than
 *   reviewing an older commit. The failure travels in `detail`.
 * - **Dirty is checked only once something would move**, so an untouched
 *   worktree with local edits reports `up-to-date` rather than a warning about
 *   changes that are in nobody's way.
 * - **Dirty never mutates.** Discarding a human's uncommitted work to make a
 *   review current is the one trade this must not make on its own.
 * - The pre-reset head is **saved to a ref before the reset**, because
 *   "upstream was rewritten" and "we have local commits" are the same shape
 *   from here: both are commits on HEAD that upstream does not contain.
 */
export function refreshWorktree(
  repo: { repoName: string; worktreePath: string },
  git: GitExec = runGit,
): WorktreeRefreshResult {
  const { repoName, worktreePath } = repo;
  const base = { repoName, fromSha: "", toSha: "", upstream: "" };

  const head = git(["rev-parse", "HEAD"], worktreePath);
  if (!head.ok || head.out === "") {
    return { ...base, status: "failed", detail: `${repoName}: not a readable git worktree — ${head.out || "no HEAD"}` };
  }
  const fromSha = head.out;

  const fetched = git(["fetch", "--prune", "origin"], worktreePath);
  const fetchNote = fetched.ok ? "" : ` (fetch failed: ${fetched.out.split("\n")[0]})`;

  const upstreamRef = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], worktreePath);
  const upstream = upstreamRef.ok ? upstreamRef.out : "";
  const target = upstream === "" ? { ok: false, out: "" } : git(["rev-parse", upstream], worktreePath);
  if (upstream === "" || !target.ok || target.out === "") {
    // Either the branch never tracked a remote, or `--prune` just removed the
    // remote-tracking ref because the branch is gone (a merged or closed PR).
    return {
      ...base,
      fromSha,
      toSha: fromSha,
      status: "no-upstream",
      detail: `${repoName}: no tracked remote branch to refresh from${fetchNote} — reviewing HEAD ${shortSha(fromSha)} as it is`,
    };
  }
  const toSha = target.out;

  if (toSha === fromSha) {
    return {
      ...base,
      fromSha,
      toSha,
      upstream,
      status: "up-to-date",
      detail: `${repoName}: already at ${upstream} ${shortSha(toSha)}${fetchNote}`,
    };
  }

  // Tracked modifications only. An untracked file survives both a fast-forward
  // and a reset, so treating one as dirty would refuse a refresh over a stray
  // log or a local `.env`.
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], worktreePath);
  if (dirty.ok && dirty.out !== "") {
    return {
      ...base,
      fromSha,
      toSha: fromSha,
      upstream,
      status: "dirty",
      detail:
        `${repoName}: NOT refreshed — the worktree has uncommitted changes, and ${upstream} has moved to ` +
        `${shortSha(toSha)}. The review below reads HEAD ${shortSha(fromSha)} plus those local changes, not the pushed branch.`,
    };
  }

  const ff = git(["merge", "--ff-only", upstream], worktreePath);
  if (ff.ok) {
    return {
      ...base,
      fromSha,
      toSha,
      upstream,
      status: "fast-forwarded",
      detail: `${repoName}: ${shortSha(fromSha)} → ${shortSha(toSha)} (fast-forward onto ${upstream})${fetchNote}`,
    };
  }

  // A refused fast-forward has two very different causes, and only one of them
  // is what a reset is for: upstream was rewritten, so HEAD is no longer on it.
  // If HEAD *is* an ancestor of upstream, git refused for some other reason —
  // an untracked file in the way, an index lock — and resetting would discard
  // working-tree state to work around a problem it does not fix.
  const onUpstream = git(["merge-base", "--is-ancestor", fromSha, upstream], worktreePath);
  if (onUpstream.ok) {
    return {
      ...base,
      fromSha,
      toSha: fromSha,
      upstream,
      status: "failed",
      detail:
        `${repoName}: could not fast-forward onto ${upstream} even though HEAD is behind it — ` +
        `${ff.out.split("\n")[0]}. Left at ${shortSha(fromSha)}.`,
    };
  }

  const backupRef = `${BACKUP_REF_PREFIX}/${fromSha}`;
  git(["update-ref", backupRef, fromSha], worktreePath);
  const reset = git(["reset", "--hard", upstream], worktreePath);
  if (!reset.ok) {
    return {
      ...base,
      fromSha,
      toSha: fromSha,
      upstream,
      status: "failed",
      detail: `${repoName}: could not move onto ${upstream} — ${reset.out.split("\n")[0]}`,
    };
  }

  return {
    ...base,
    fromSha,
    toSha,
    upstream,
    status: "reset",
    backupRef,
    detail:
      `${repoName}: ${shortSha(fromSha)} → ${shortSha(toSha)} (${upstream} was rewritten, so HEAD was reset onto it). ` +
      `The old head is kept at \`${backupRef}\`.`,
  };
}

export function refreshWorktrees(
  repos: { repoName: string; worktreePath: string }[],
  git: GitExec = runGit,
): WorktreeRefreshResult[] {
  return repos.map((repo) => refreshWorktree(repo, git));
}

/** Whether a status means the review that follows reads something other than the pushed branch. */
export function isRefreshWarning(status: WorktreeRefreshStatus): boolean {
  return status === "dirty" || status === "failed";
}

/** One line naming what moved, for the phase result. */
export function summarizeWorktreeRefresh(results: WorktreeRefreshResult[]): string {
  if (results.length === 0) return "No repositories to refresh.";

  const moved = results.filter((r) => r.status === "fast-forwarded" || r.status === "reset");
  const warnings = results.filter((r) => isRefreshWarning(r.status));

  const parts = [
    moved.length > 0 ? `${moved.length} updated` : null,
    results.filter((r) => r.status === "up-to-date").length > 0
      ? `${results.filter((r) => r.status === "up-to-date").length} already current`
      : null,
    results.filter((r) => r.status === "no-upstream").length > 0
      ? `${results.filter((r) => r.status === "no-upstream").length} without a tracked branch`
      : null,
    warnings.length > 0 ? `${warnings.length} left as-is` : null,
  ].filter(Boolean);

  const headline =
    moved.length === 0 && warnings.length === 0
      ? "Every worktree was already at its tracked branch"
      : parts.join(", ");

  return [headline, "", ...results.map((r) => `- ${r.detail}`)].join("\n");
}
