import { describe, it, expect } from "vitest";
import {
  abortMerge,
  finalizeConflictedMerge,
  findConflictMarkers,
  isBaseMergeProblem,
  mergeBaseIntoBranch,
  pushMergedBranch,
  summarizeBaseMerges,
  type BaseMergeOutcome,
  type GitExec,
} from "@/lib/workspace/base-merge";

/**
 * A fake git keyed by the whole argument list, recording every call so a test
 * can assert what was *not* run — which is the point of the dirty case and of
 * every rollback below.
 */
function fakeGit(
  answers: Record<string, { ok: boolean; out: string }>,
): GitExec & { calls: string[] } {
  const calls: string[] = [];
  const git = ((args: string[]) => {
    calls.push(args.join(" "));
    const key = args.join(" ");
    return answers[key] ?? { ok: false, out: `unexpected: git ${key}` };
  }) as GitExec & { calls: string[] };
  git.calls = calls;
  return git;
}

const repo = { repoName: "widgets", worktreePath: "/ws/task/widgets" };
const HEAD_SHA = "1111111111111111111111111111111111111111";
const PUSHED_SHA = "3333333333333333333333333333333333333333";

const HEAD = "rev-parse HEAD";
const BRANCH = "symbolic-ref --short HEAD";
const MERGE_HEAD = "rev-parse --verify --quiet MERGE_HEAD";
// An explicit forced refspec, not `fetch origin main`: that form leaves the
// remote-tracking update to git's opportunistic behaviour and exits 0 either way.
const FETCH = "fetch --force origin refs/heads/main:refs/remotes/origin/main";
const BASE_SHA = "rev-parse --verify origin/main";
const TRACKED = "rev-parse --verify refs/remotes/origin/feature/widget-x";
const PUSHED_IS_BEHIND = `merge-base --is-ancestor ${PUSHED_SHA} HEAD`;
const IS_ANCESTOR = "merge-base --is-ancestor origin/main HEAD";
const STATUS = "status --porcelain --untracked-files=no";
const MERGE = "merge --no-ff --no-edit origin/main";
const UNMERGED = "diff --name-only --diff-filter=U";
const ABORT = "merge --abort";
const COMMIT = "commit --no-edit";

/**
 * The happy path up to (not including) the merge itself: the worktree is at the
 * pull request's head and the base is not contained yet.
 */
function upToMerge(extra: Record<string, { ok: boolean; out: string }>) {
  return fakeGit({
    [HEAD]: { ok: true, out: HEAD_SHA },
    [BRANCH]: { ok: true, out: "feature/widget-x" },
    [MERGE_HEAD]: { ok: false, out: "" },
    [FETCH]: { ok: true, out: "" },
    [BASE_SHA]: { ok: true, out: "2".repeat(40) },
    [TRACKED]: { ok: true, out: HEAD_SHA },
    [IS_ANCESTOR]: { ok: false, out: "" },
    [STATUS]: { ok: true, out: "" },
    ...extra,
  });
}

describe("mergeBaseIntoBranch", () => {
  it("reports already-current only when the pull request holds that commit too", () => {
    const git = upToMerge({ [IS_ANCESTOR]: { ok: true, out: "" } });

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", prHeadSha: HEAD_SHA },
      git,
    );

    expect(attempt.stage).toBe("already-current");
    // A branch with nothing to merge must not be judged for local edits: a dirty
    // tree that nothing is about to touch is not a problem to report.
    expect(git.calls).not.toContain(STATUS);
    expect(git.calls).not.toContain(MERGE);
  });

  // The bug this exists for: the first version answered from `--is-ancestor
  // origin/<base> HEAD` alone, so a merge sitting unpushed in the worktree came
  // back as "already contains origin/master" while GitHub went on showing the
  // pull request as conflicting — GitHub judges the pushed head.
  it("calls a locally-merged, unpushed branch unpushed rather than current", () => {
    const git = upToMerge({
      [IS_ANCESTOR]: { ok: true, out: "" },
      [PUSHED_IS_BEHIND]: { ok: true, out: "" },
    });

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", prHeadSha: PUSHED_SHA },
      git,
    );

    expect(attempt.stage).toBe("unpushed");
    expect(attempt.detail).toContain("local only");
    // Nothing to merge — the work left is the push, which the caller does.
    expect(git.calls).not.toContain(MERGE);
  });

  it("names the shas every verdict rests on", () => {
    // The report that was wrong named none, so it could not be checked after
    // the fact.
    const git = upToMerge({ [IS_ANCESTOR]: { ok: true, out: "" } });

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", prHeadSha: HEAD_SHA },
      git,
    );

    expect(attempt.detail).toContain("2".repeat(8));
    expect(attempt.detail).toContain("1".repeat(8));
  });

  it("refuses a worktree that is behind the pushed head", () => {
    // Merging here could only be pushed as a non-fast-forward, and finding that
    // out afterwards costs a conflict resolution against code that is not current.
    const git = upToMerge({ [PUSHED_IS_BEHIND]: { ok: false, out: "" } });

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", prHeadSha: PUSHED_SHA },
      git,
    );

    expect(attempt.stage).toBe("stale");
    expect(git.calls).not.toContain(MERGE);
  });

  it("falls back to the remote-tracking ref when no PR head is given", () => {
    const git = upToMerge({
      [IS_ANCESTOR]: { ok: true, out: "" },
      [TRACKED]: { ok: true, out: PUSHED_SHA },
      [PUSHED_IS_BEHIND]: { ok: true, out: "" },
    });

    expect(mergeBaseIntoBranch(repo, { baseBranch: "main" }, git).stage).toBe("unpushed");
    expect(git.calls).toContain(TRACKED);
  });

  it("treats a branch with no pushed state as needing the push", () => {
    const git = upToMerge({
      [IS_ANCESTOR]: { ok: true, out: "" },
      [TRACKED]: { ok: false, out: "fatal: Needed a single revision" },
    });

    expect(mergeBaseIntoBranch(repo, { baseBranch: "main" }, git).stage).toBe("unpushed");
  });

  it("creates the merge commit when there are no conflicts", () => {
    const git = upToMerge({ [MERGE]: { ok: true, out: "Merge made by the 'ort' strategy." } });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("clean");
    expect(attempt.branch).toBe("feature/widget-x");
    expect(attempt.conflictedFiles).toEqual([]);
  });

  it("returns the conflicted paths and leaves the merge in progress", () => {
    const git = upToMerge({
      [MERGE]: { ok: false, out: "CONFLICT (content): Merge conflict in src/a.ts" },
      [UNMERGED]: { ok: true, out: "src/a.ts\nsrc/b.ts\n" },
    });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("conflicted");
    expect(attempt.conflictedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    // The resolver reads the index, so the merge has to still be there.
    expect(git.calls).not.toContain(ABORT);
  });

  it("rolls back a merge that failed with nothing to resolve", () => {
    // git refuses for reasons that are not conflicts — an untracked file in the
    // way, a missing identity. Leaving the worktree half-merged would strand
    // every later phase, and there is nothing for an agent to fix.
    const git = upToMerge({
      [MERGE]: { ok: false, out: "error: Your local changes would be overwritten" },
      [UNMERGED]: { ok: true, out: "" },
      [ABORT]: { ok: true, out: "" },
    });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("failed");
    expect(git.calls).toContain(ABORT);
  });

  it("never merges into a dirty worktree", () => {
    const git = upToMerge({ [STATUS]: { ok: true, out: " M src/a.ts" } });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("dirty");
    expect(git.calls).not.toContain(MERGE);
  });

  it("refuses a worktree that is not on the pull request's head branch", () => {
    // Everything downstream pushes to the PR's branch, so merging here would put
    // this branch's commits on that PR.
    const git = upToMerge({});

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", expectedBranch: "feature/other" },
      git,
    );

    expect(attempt.stage).toBe("failed");
    expect(attempt.detail).toContain("feature/other");
    expect(git.calls).not.toContain(MERGE);
  });

  it("accepts a worktree that is on the pull request's head branch", () => {
    const git = upToMerge({ [MERGE]: { ok: true, out: "" } });

    const attempt = mergeBaseIntoBranch(
      repo,
      { baseBranch: "main", expectedBranch: "feature/widget-x" },
      git,
    );

    expect(attempt.stage).toBe("clean");
  });

  it("refuses to touch a merge that is already in progress", () => {
    const git = upToMerge({ [MERGE_HEAD]: { ok: true, out: "3".repeat(40) } });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("failed");
    expect(attempt.detail).toContain("already in progress");
    expect(git.calls).not.toContain(MERGE);
  });

  it("merges a locally known base ref when the fetch fails", () => {
    // The same trade `refreshWorktree` makes: a ref from an earlier fetch is a
    // few commits stale at worst, and merging it beats not merging at all.
    const git = upToMerge({
      [FETCH]: { ok: false, out: "fatal: unable to access remote" },
      [MERGE]: { ok: true, out: "" },
    });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("clean");
    expect(attempt.detail).toContain("fetch failed");
  });

  it("fails when the base ref cannot be resolved at all", () => {
    const git = upToMerge({
      [FETCH]: { ok: false, out: "fatal: unable to access remote" },
      [BASE_SHA]: { ok: false, out: "fatal: Needed a single revision" },
    });

    const attempt = mergeBaseIntoBranch(repo, { baseBranch: "main" }, git);

    expect(attempt.stage).toBe("failed");
    expect(git.calls).not.toContain(MERGE);
  });

  it("fails on a detached HEAD, which has no branch to push", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: HEAD_SHA },
      [BRANCH]: { ok: false, out: "fatal: ref HEAD is not a symbolic ref" },
    });

    expect(mergeBaseIntoBranch(repo, { baseBranch: "main" }, git).stage).toBe("failed");
  });
});

describe("findConflictMarkers", () => {
  const GREP = "grep --cached -I -l -E ^(<<<<<<<|>>>>>>>)  -- src/a.ts";

  it("reports the staged files that still carry markers", () => {
    const git = fakeGit({ [GREP]: { ok: true, out: "src/a.ts\n" } });
    expect(findConflictMarkers("/ws/task/widgets", ["src/a.ts"], git)).toEqual(["src/a.ts"]);
  });

  it("treats git grep's no-match exit as clean", () => {
    const git = fakeGit({ [GREP]: { ok: false, out: "" } });
    expect(findConflictMarkers("/ws/task/widgets", ["src/a.ts"], git)).toEqual([]);
  });

  it("does not run git grep without paths to scan", () => {
    const git = fakeGit({});
    expect(findConflictMarkers("/ws/task/widgets", [], git)).toEqual([]);
    expect(git.calls).toEqual([]);
  });
});

describe("finalizeConflictedMerge", () => {
  const GREP = "grep --cached -I -l -E ^(<<<<<<<|>>>>>>>)  -- src/a.ts";

  it("commits the merge once the index is clean", () => {
    const git = fakeGit({
      [UNMERGED]: { ok: true, out: "" },
      [GREP]: { ok: false, out: "" },
      [MERGE_HEAD]: { ok: true, out: "3".repeat(40) },
      [COMMIT]: { ok: true, out: "[feature/widget-x abc1234] Merge" },
    });

    const result = finalizeConflictedMerge(repo, ["src/a.ts"], git);

    expect(result.ok).toBe(true);
    expect(result.aborted).toBe(false);
  });

  it("rolls back when a path was left unmerged", () => {
    // The resolver can report a file as done and forget to `git add` it, so the
    // verdict comes from git rather than from what it said.
    const git = fakeGit({
      [UNMERGED]: { ok: true, out: "src/a.ts" },
      [ABORT]: { ok: true, out: "" },
    });

    const result = finalizeConflictedMerge(repo, ["src/a.ts"], git);

    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.unresolved).toEqual(["src/a.ts"]);
    expect(git.calls).not.toContain(COMMIT);
  });

  it("rolls back when conflict markers are still staged", () => {
    const git = fakeGit({
      [UNMERGED]: { ok: true, out: "" },
      [GREP]: { ok: true, out: "src/a.ts" },
      [ABORT]: { ok: true, out: "" },
    });

    const result = finalizeConflictedMerge(repo, ["src/a.ts"], git);

    expect(result.ok).toBe(false);
    expect(result.unresolved).toEqual(["src/a.ts"]);
    expect(git.calls).not.toContain(COMMIT);
  });

  it("accepts a merge the resolver committed itself", () => {
    // Its prompt forbids that, and the tool grants cannot reliably prevent it.
    // MERGE_HEAD is gone and the index is clean, so the work is where the push
    // needs it; re-committing would fail and roll back a correct resolution.
    const git = fakeGit({
      [UNMERGED]: { ok: true, out: "" },
      [GREP]: { ok: false, out: "" },
      [MERGE_HEAD]: { ok: false, out: "" },
    });

    const result = finalizeConflictedMerge(repo, ["src/a.ts"], git);

    expect(result.ok).toBe(true);
    expect(git.calls).not.toContain(COMMIT);
  });

  it("rolls back a commit that git refused", () => {
    const git = fakeGit({
      [UNMERGED]: { ok: true, out: "" },
      [GREP]: { ok: false, out: "" },
      [MERGE_HEAD]: { ok: true, out: "3".repeat(40) },
      [COMMIT]: { ok: false, out: "error: cannot commit" },
      [ABORT]: { ok: true, out: "" },
    });

    const result = finalizeConflictedMerge(repo, ["src/a.ts"], git);

    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
  });
});

describe("abortMerge", () => {
  it("rolls an in-progress merge back", () => {
    // The escape hatch for a phase that is going away mid-resolution: the
    // resolution in the worktree was never checked, and a mid-merge worktree
    // reads as dirty to everything downstream.
    const git = fakeGit({ [ABORT]: { ok: true, out: "" } });
    abortMerge(repo, git);
    expect(git.calls).toEqual([ABORT]);
  });
});

describe("pushMergedBranch", () => {
  it("pushes without any force flag", () => {
    const git = fakeGit({ "push origin feature/widget-x": { ok: true, out: "" } });

    expect(pushMergedBranch(repo, "feature/widget-x", git).ok).toBe(true);
    expect(git.calls.join(" ")).not.toContain("--force");
  });

  it("reports a rejected push rather than retrying it", () => {
    const git = fakeGit({
      "push origin feature/widget-x": {
        ok: false,
        out: "! [rejected] feature/widget-x -> feature/widget-x (non-fast-forward)",
      },
    });

    const result = pushMergedBranch(repo, "feature/widget-x", git);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("rejected");
  });
});

function outcome(overrides: Partial<BaseMergeOutcome> = {}): BaseMergeOutcome {
  return {
    repoName: "widgets",
    prUrl: "https://github.com/acme/widgets/pull/42",
    baseBranch: "main",
    status: "pushed",
    aiResolved: false,
    conflictedFiles: [],
    detail: "widgets: merged origin/main into `feature/widget-x` with no conflicts",
    ...overrides,
  };
}

describe("isBaseMergeProblem", () => {
  it("counts only the two settled states as fine", () => {
    expect(isBaseMergeProblem("pushed")).toBe(false);
    expect(isBaseMergeProblem("already-current")).toBe(false);
    for (const status of ["unresolved", "dirty", "failed", "push-failed"] as const) {
      expect(isBaseMergeProblem(status)).toBe(true);
    }
  });
});

describe("summarizeBaseMerges", () => {
  it("says nothing was pending when every pull request already had its base", () => {
    const text = summarizeBaseMerges([outcome({ status: "already-current" })]);
    // The headline says whose state it describes — the pull request's, not the
    // worktree's, which is the distinction the wrong report collapsed.
    expect(text).toContain("Every pull request already holds its base branch");
    // No merge was pushed, so the CI caveat would be about nothing.
    expect(text).not.toContain("lint / test / build");
  });

  it("counts the conflicts an agent resolved separately from clean merges", () => {
    const text = summarizeBaseMerges([
      outcome(),
      outcome({ repoName: "api", aiResolved: true, detail: "api: resolved" }),
    ]);
    expect(text).toContain("2 pushed");
    expect(text).toContain("1 after resolving conflicts");
  });

  it("names what a human has to look at, and that nothing verified the merge", () => {
    const text = summarizeBaseMerges([
      outcome(),
      outcome({ repoName: "api", status: "unresolved", detail: "api: still unresolved" }),
    ]);
    expect(text).toContain("1 needing attention");
    expect(text).toContain("api: still unresolved");
    expect(text).toContain("lint / test / build");
  });

  it("reports an empty selection as nothing to do", () => {
    expect(summarizeBaseMerges([])).toContain("No open pull requests");
  });
});
