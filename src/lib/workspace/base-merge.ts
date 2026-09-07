/**
 * Merging a pull request's base branch back into the branch it targets.
 *
 * A workspace worktree is cut from `origin/<base>` once and never moves, so a
 * base branch that has advanced since leaves the PR behind it — and, once the
 * two sides touch the same lines, unmergeable until someone sits down with the
 * conflicts. This module is the deterministic half of doing that: fetch, merge
 * `--no-ff`, and afterwards commit and push. The conflicts themselves are the
 * one part no decision table can settle, so they go to an agent, and everything
 * around that agent lives here.
 *
 * Deliberately TypeScript rather than an agent instruction, for the same reasons
 * as `worktree-refresh.ts`: each state below has exactly one right answer, and
 * the commit and the push must not be reachable from the agent that edits the
 * files — a resolver that commits by itself defeats the marker check that stands
 * between a half-merged file and someone else's PR.
 *
 * Every git call goes through one injected seam (`GitExec`) so the decision
 * table is unit-testable without a repository. A failing call yields
 * `ok: false` rather than throwing: most of what fails here is a state to report
 * (dirty tree, rejected push), not an exception.
 */

import { getCleanEnv } from "../env";

export type GitExec = (args: string[], cwd: string) => { ok: boolean; out: string };

/** What the deterministic merge attempt left behind. */
export type BaseMergeStage =
  /** `origin/<base>` is already an ancestor of HEAD — nothing to merge. */
  | "already-current"
  /** `git merge --no-ff` succeeded on its own and created the merge commit. */
  | "clean"
  /** The merge stopped with conflicts; the index holds them, awaiting resolution. */
  | "conflicted"
  /** Uncommitted changes — nothing was attempted, since a merge would touch them. */
  | "dirty"
  /** A git command failed, or the worktree is not in a state to merge into. */
  | "failed";

export interface BaseMergeAttempt {
  repoName: string;
  stage: BaseMergeStage;
  /** Paths git left unmerged. Non-empty only for `conflicted`. */
  conflictedFiles: string[];
  /** HEAD before the merge. Empty when it could not be read. */
  fromSha: string;
  /** The worktree's branch, as `git symbolic-ref` reports it. */
  branch: string;
  /** One line for the operation log: what happened, or why nothing did. */
  detail: string;
}

/** The per-repository record the pipeline reports, after commit and push. */
export interface BaseMergeOutcome {
  repoName: string;
  prUrl: string;
  baseBranch: string;
  status:
    /** The base was already in the branch. */
    | "already-current"
    /** A merge commit was created and pushed. */
    | "pushed"
    /** Conflicts survived the resolution attempt; the merge was rolled back. */
    | "unresolved"
    /** Uncommitted changes in the worktree; nothing was attempted. */
    | "dirty"
    /** The merge itself could not be run or completed. */
    | "failed"
    /** The merge landed locally but the remote refused it. */
    | "push-failed";
  /** Whether an agent had to resolve conflicts to get there. */
  aiResolved: boolean;
  conflictedFiles: string[];
  detail: string;
}

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

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * Conflict markers left in the index, over the paths that were conflicted.
 *
 * The staged content is what a commit would carry, so that — not the working
 * tree — is what gets checked. Scoped to the conflicted paths because a
 * repository may legitimately contain a line like `>>>>>>> ` in a document
 * about merges, and a file this merge never touched is none of our business.
 * `git grep` exits 1 when it matches nothing, which is the wanted case.
 */
export function findConflictMarkers(
  worktreePath: string,
  files: string[],
  git: GitExec = runGit,
): string[] {
  if (files.length === 0) return [];
  const result = git(
    ["grep", "--cached", "-I", "-l", "-E", "^(<<<<<<<|>>>>>>>) ", "--", ...files],
    worktreePath,
  );
  if (!result.ok) return [];
  return lines(result.out);
}

/**
 * Fetch `origin/<base>` and merge it into the worktree's branch with `--no-ff`.
 *
 * Ordering carries the substance:
 *
 * - **The branch is checked against the PR's head ref before anything moves.**
 *   Everything downstream pushes to the branch the PR is open on, so a worktree
 *   sitting somewhere else must not be merged into — the push would land this
 *   branch's commits on someone else's PR.
 * - **A merge already in progress is refused, not continued.** It belongs to
 *   whoever started it, and its index is the one thing the resolver reads.
 * - **A failed fetch is not fatal**, matching `refreshWorktree`: a locally known
 *   `origin/<base>` from an earlier fetch is still worth merging, and it is
 *   `rev-parse --verify` that decides whether there is anything to merge at all.
 * - **`already-current` is decided before the dirty check**, so a worktree with
 *   local edits and nothing to merge reports the truth rather than a warning
 *   about changes standing in nobody's way.
 * - **A merge that failed with no unmerged paths is rolled back.** That is not
 *   the conflict case — it is git refusing for some other reason — and leaving
 *   the worktree half-merged would strand every later phase.
 */
export function mergeBaseIntoBranch(
  repo: { repoName: string; worktreePath: string },
  opts: { baseBranch: string; expectedBranch?: string },
  git: GitExec = runGit,
): BaseMergeAttempt {
  const { repoName, worktreePath } = repo;
  const { baseBranch, expectedBranch } = opts;
  const baseRef = `origin/${baseBranch}`;
  const base = { repoName, conflictedFiles: [] as string[], fromSha: "", branch: "" };

  const head = git(["rev-parse", "HEAD"], worktreePath);
  if (!head.ok || head.out === "") {
    return {
      ...base,
      stage: "failed",
      detail: `${repoName}: not a readable git worktree — ${head.out || "no HEAD"}`,
    };
  }
  const fromSha = head.out;

  const branchRef = git(["symbolic-ref", "--short", "HEAD"], worktreePath);
  if (!branchRef.ok || branchRef.out === "") {
    return {
      ...base,
      fromSha,
      stage: "failed",
      detail: `${repoName}: HEAD is detached, so there is no branch to merge into or push`,
    };
  }
  const branch = branchRef.out;

  if (expectedBranch && expectedBranch !== "" && branch !== expectedBranch) {
    return {
      ...base,
      fromSha,
      branch,
      stage: "failed",
      detail:
        `${repoName}: the worktree is on \`${branch}\` but the pull request's head is \`${expectedBranch}\` — ` +
        `left alone, since merging here would push this branch's commits onto that PR`,
    };
  }

  const inMerge = git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], worktreePath);
  if (inMerge.ok && inMerge.out !== "") {
    return {
      ...base,
      fromSha,
      branch,
      stage: "failed",
      detail: `${repoName}: a merge is already in progress in this worktree — finish or abort it first`,
    };
  }

  const fetched = git(["fetch", "origin", baseBranch], worktreePath);
  const fetchNote = fetched.ok ? "" : ` (fetch failed: ${firstLine(fetched.out)})`;

  const baseSha = git(["rev-parse", "--verify", baseRef], worktreePath);
  if (!baseSha.ok || baseSha.out === "") {
    return {
      ...base,
      fromSha,
      branch,
      stage: "failed",
      detail: `${repoName}: \`${baseRef}\` could not be resolved${fetchNote || ` — ${firstLine(baseSha.out)}`}`,
    };
  }

  if (git(["merge-base", "--is-ancestor", baseRef, "HEAD"], worktreePath).ok) {
    return {
      ...base,
      fromSha,
      branch,
      stage: "already-current",
      detail: `${repoName}: \`${branch}\` already contains ${baseRef}${fetchNote}`,
    };
  }

  const dirty = git(["status", "--porcelain", "--untracked-files=no"], worktreePath);
  if (dirty.ok && dirty.out !== "") {
    return {
      ...base,
      fromSha,
      branch,
      stage: "dirty",
      detail:
        `${repoName}: NOT merged — the worktree has uncommitted changes, and a merge of ${baseRef} would ` +
        `touch them. Commit or stash them and run this again.`,
    };
  }

  const merge = git(["merge", "--no-ff", "--no-edit", baseRef], worktreePath);
  if (merge.ok) {
    return {
      ...base,
      fromSha,
      branch,
      stage: "clean",
      detail: `${repoName}: merged ${baseRef} into \`${branch}\` with no conflicts${fetchNote}`,
    };
  }

  const unmerged = lines(git(["diff", "--name-only", "--diff-filter=U"], worktreePath).out);
  if (unmerged.length === 0) {
    git(["merge", "--abort"], worktreePath);
    return {
      ...base,
      fromSha,
      branch,
      stage: "failed",
      detail: `${repoName}: \`git merge --no-ff ${baseRef}\` failed with no conflicts to resolve — ${firstLine(merge.out)}. The merge was rolled back.`,
    };
  }

  return {
    ...base,
    fromSha,
    branch,
    conflictedFiles: unmerged,
    stage: "conflicted",
    detail: `${repoName}: merging ${baseRef} conflicts in ${unmerged.length} file(s): ${unmerged.join(", ")}`,
  };
}

/**
 * Roll an in-progress merge back, for the path where the phase itself is going
 * away — a thrown error, or a budget that ran out mid-resolution. A worktree
 * left mid-merge is dirty to every later phase and to whoever opens it next,
 * and the resolution it holds was never verified.
 */
export function abortMerge(
  repo: { worktreePath: string },
  git: GitExec = runGit,
): void {
  git(["merge", "--abort"], repo.worktreePath);
}

export interface ConflictFinalizeResult {
  ok: boolean;
  /** Paths still unmerged, or still carrying conflict markers in the index. */
  unresolved: string[];
  /** True when the merge was rolled back, so the worktree is where it started. */
  aborted: boolean;
  detail: string;
}

/**
 * Turn a resolved conflict into the merge commit, or roll the merge back.
 *
 * The resolution is judged from git and from the staged content, never from what
 * the resolver said it did: an unmerged path it forgot to `git add`, or a
 * conflict marker it left in a file it did add, are both things it can report as
 * done. Either one rolls the merge back rather than committing, because the next
 * step is a push onto an open pull request.
 *
 * A resolver that committed the merge itself — which its prompt forbids, and
 * which the tool grants do not reliably prevent — is accepted rather than
 * re-committed: MERGE_HEAD is gone, the index is clean, and the work is already
 * where the push needs it.
 */
export function finalizeConflictedMerge(
  repo: { repoName: string; worktreePath: string },
  conflictedFiles: string[],
  git: GitExec = runGit,
): ConflictFinalizeResult {
  const { repoName, worktreePath } = repo;

  const rollback = (unresolved: string[], detail: string): ConflictFinalizeResult => {
    git(["merge", "--abort"], worktreePath);
    return { ok: false, unresolved, aborted: true, detail };
  };

  const unmerged = lines(git(["diff", "--name-only", "--diff-filter=U"], worktreePath).out);
  if (unmerged.length > 0) {
    return rollback(
      unmerged,
      `${repoName}: ${unmerged.length} file(s) are still unresolved (${unmerged.join(", ")}). The merge was rolled back, so the branch is unchanged.`,
    );
  }

  const marked = findConflictMarkers(worktreePath, conflictedFiles, git);
  if (marked.length > 0) {
    return rollback(
      marked,
      `${repoName}: conflict markers are still staged in ${marked.join(", ")}. The merge was rolled back rather than pushed.`,
    );
  }

  const inMerge = git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], worktreePath);
  if (!inMerge.ok || inMerge.out === "") {
    return {
      ok: true,
      unresolved: [],
      aborted: false,
      detail: `${repoName}: conflicts resolved; the merge was already committed in the worktree`,
    };
  }

  const commit = git(["commit", "--no-edit"], worktreePath);
  if (!commit.ok) {
    return rollback(
      conflictedFiles,
      `${repoName}: the resolved merge could not be committed — ${firstLine(commit.out)}. The merge was rolled back.`,
    );
  }

  return {
    ok: true,
    unresolved: [],
    aborted: false,
    detail: `${repoName}: conflicts resolved in ${conflictedFiles.length} file(s) and committed`,
  };
}

/**
 * Push the merge to the branch the pull request is open on.
 *
 * No `--force` of any kind: the merge commit sits on top of the branch, so a
 * rejected push means the remote holds something this worktree has not seen,
 * which is a state to report rather than to overwrite.
 */
export function pushMergedBranch(
  repo: { repoName: string; worktreePath: string },
  branch: string,
  git: GitExec = runGit,
): { ok: boolean; detail: string } {
  const push = git(["push", "origin", branch], repo.worktreePath);
  if (push.ok) {
    return { ok: true, detail: `${repo.repoName}: pushed \`${branch}\` to origin` };
  }
  return {
    ok: false,
    detail:
      `${repo.repoName}: the merge is committed locally but the push was rejected — ${firstLine(push.out)}. ` +
      `The pull request still shows the un-merged branch.`,
  };
}

/** Whether an outcome is one a human has to look at. */
export function isBaseMergeProblem(status: BaseMergeOutcome["status"]): boolean {
  return status !== "already-current" && status !== "pushed";
}

/** One block for the phase result: what landed, and what needs a human. */
export function summarizeBaseMerges(outcomes: BaseMergeOutcome[]): string {
  if (outcomes.length === 0) {
    return "No open pull requests to merge the base branch into.";
  }

  const pushed = outcomes.filter((o) => o.status === "pushed");
  const resolved = pushed.filter((o) => o.aiResolved);
  const current = outcomes.filter((o) => o.status === "already-current");
  const problems = outcomes.filter((o) => isBaseMergeProblem(o.status));

  const parts = [
    pushed.length > 0
      ? `${pushed.length} pushed${resolved.length > 0 ? ` (${resolved.length} after resolving conflicts)` : ""}`
      : null,
    current.length > 0 ? `${current.length} already current` : null,
    problems.length > 0 ? `${problems.length} needing attention` : null,
  ].filter(Boolean);

  const headline =
    problems.length === 0 && pushed.length === 0
      ? "Every pull request's branch already contains its base"
      : parts.join(", ");

  const body = outcomes.map((o) => `- ${o.detail}${o.prUrl ? `\n  - ${o.prUrl}` : ""}`);

  const footer =
    pushed.length > 0
      ? [
          "",
          "The merge commits are pushed, so the pull requests' CI now runs against them — " +
            "nothing here ran the repositories' own lint / test / build. Check the Pull Requests tab for red checks.",
        ]
      : [];

  return [headline, "", ...body, ...footer].join("\n");
}
