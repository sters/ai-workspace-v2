import { describe, it, expect } from "vitest";
import {
  refreshWorktree,
  refreshWorktrees,
  summarizeWorktreeRefresh,
  type GitExec,
} from "@/lib/workspace/worktree-refresh";

/**
 * A fake git whose answers are keyed by the leading subcommand plus enough of
 * the arguments to tell the two `rev-parse` calls apart. Every call is recorded
 * so a test can assert what was *not* run — which is the point of the dirty
 * case.
 */
function fakeGit(
  answers: Record<string, { ok: boolean; out: string }>,
): GitExec & { calls: string[][] } {
  const calls: string[][] = [];
  const git = ((args: string[]) => {
    calls.push(args);
    const key = args.join(" ");
    return answers[key] ?? { ok: false, out: `unexpected: git ${key}` };
  }) as GitExec & { calls: string[][] };
  git.calls = calls;
  return git;
}

const HEAD = "rev-parse HEAD";
const UPSTREAM_NAME = "rev-parse --abbrev-ref --symbolic-full-name @{u}";
const UPSTREAM_SHA = "rev-parse origin/feature-x";
const FETCH = "fetch --prune origin";
const STATUS = "status --porcelain --untracked-files=no";
const IS_ANCESTOR = `merge-base --is-ancestor ${"1".repeat(40)} origin/feature-x`;
const FF = "merge --ff-only origin/feature-x";

const repo = { repoName: "svc", worktreePath: "/ws/svc" };

const OLD = "1111111111111111111111111111111111111111";
const NEW = "2222222222222222222222222222222222222222";

describe("refreshWorktree", () => {
  it("reports up-to-date without touching the working tree", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: OLD },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("up-to-date");
    expect(result.fromSha).toBe(OLD);
    expect(result.toSha).toBe(OLD);
    // A worktree that needs nothing must not be inspected for local edits: a
    // dirty tree nothing is about to overwrite is not a problem to report.
    expect(git.calls.map((c) => c.join(" "))).not.toContain(STATUS);
  });

  it("ignores untracked files when deciding whether the tree is dirty", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      // `--untracked-files=no`, so a stray local file never reaches this output.
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: true, out: "Fast-forward" },
    });

    expect(refreshWorktree(repo, git).status).toBe("fast-forwarded");
    expect(git.calls.map((c) => c.join(" "))).toContain(STATUS);
  });

  it("fast-forwards when upstream moved ahead", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: true, out: "Fast-forward" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("fast-forwarded");
    expect(result.toSha).toBe(NEW);
    expect(result.backupRef).toBeUndefined();
    expect(git.calls.map((c) => c[0])).not.toContain("reset");
  });

  it("resets onto a rewritten upstream, keeping the discarded head on a ref", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: false, out: "fatal: Not possible to fast-forward, aborting." },
      [IS_ANCESTOR]: { ok: false, out: "" },
      [`update-ref refs/aiw-refresh-backup/${OLD} ${OLD}`]: { ok: true, out: "" },
      ["reset --hard origin/feature-x"]: { ok: true, out: `HEAD is now at ${NEW}` },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("reset");
    expect(result.toSha).toBe(NEW);
    expect(result.backupRef).toBe(`refs/aiw-refresh-backup/${OLD}`);
    // The backup has to exist before the reset, or a force-pushed-over local
    // commit is simply gone.
    const order = git.calls.map((c) => c[0]);
    expect(order.indexOf("update-ref")).toBeLessThan(order.indexOf("reset"));
  });

  it("refuses to move a dirty worktree and says what the review will read", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: " M src/index.ts" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("dirty");
    expect(result.toSha).toBe(OLD);
    expect(result.detail).toContain("uncommitted changes");
    const subcommands = git.calls.map((c) => c[0]);
    expect(subcommands).not.toContain("merge");
    expect(subcommands).not.toContain("reset");
  });

  it("does not reset when the fast-forward was merely obstructed", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: false, out: "error: untracked working tree files would be overwritten" },
      // HEAD is still an ancestor of upstream, so nothing was rewritten and
      // there is no rewritten history for a reset to recover from.
      [IS_ANCESTOR]: { ok: true, out: "" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("failed");
    expect(result.toSha).toBe(OLD);
    const subcommands = git.calls.map((c) => c[0]);
    expect(subcommands).not.toContain("reset");
    expect(subcommands).not.toContain("update-ref");
  });

  it("reports no-upstream when the tracked branch is gone", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      // `--prune` removed the remote-tracking ref: the PR branch was deleted.
      [UPSTREAM_NAME]: { ok: false, out: "fatal: no upstream configured" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("no-upstream");
    expect(result.toSha).toBe(OLD);
    expect(git.calls.map((c) => c[0])).not.toContain("reset");
  });

  it("still moves onto a known-newer upstream when the fetch itself failed", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: false, out: "fatal: unable to access 'https://...': network is unreachable" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: true, out: "Fast-forward" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("fast-forwarded");
    expect(result.detail).toContain("fetch failed");
  });

  it("fails when the path is not a git worktree", () => {
    const git = fakeGit({ [HEAD]: { ok: false, out: "fatal: not a git repository" } });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("failed");
    expect(git.calls).toHaveLength(1);
  });

  it("fails when the reset itself is rejected", () => {
    const git = fakeGit({
      [HEAD]: { ok: true, out: OLD },
      [FETCH]: { ok: true, out: "" },
      [UPSTREAM_NAME]: { ok: true, out: "origin/feature-x" },
      [UPSTREAM_SHA]: { ok: true, out: NEW },
      [STATUS]: { ok: true, out: "" },
      [FF]: { ok: false, out: "fatal: Not possible to fast-forward" },
      [IS_ANCESTOR]: { ok: false, out: "" },
      [`update-ref refs/aiw-refresh-backup/${OLD} ${OLD}`]: { ok: true, out: "" },
      ["reset --hard origin/feature-x"]: { ok: false, out: "error: unable to unlink old file" },
    });

    const result = refreshWorktree(repo, git);

    expect(result.status).toBe("failed");
    expect(result.toSha).toBe(OLD);
  });
});

describe("refreshWorktrees", () => {
  it("returns one result per repo, in order", () => {
    const git = fakeGit({ [HEAD]: { ok: false, out: "fatal: not a git repository" } });
    const results = refreshWorktrees(
      [
        { repoName: "a", worktreePath: "/ws/a" },
        { repoName: "b", worktreePath: "/ws/b" },
      ],
      git,
    );
    expect(results.map((r) => r.repoName)).toEqual(["a", "b"]);
  });
});

describe("summarizeWorktreeRefresh", () => {
  function result(
    repoName: string,
    status: Parameters<typeof summarizeWorktreeRefresh>[0][number]["status"],
  ) {
    return { repoName, status, fromSha: OLD, toSha: NEW, upstream: "origin/x", detail: `${repoName}: ${status}` };
  }

  it("names every repo's outcome under a headline", () => {
    const text = summarizeWorktreeRefresh([result("a", "fast-forwarded"), result("b", "dirty")]);
    expect(text).toContain("1 updated");
    expect(text).toContain("1 left as-is");
    expect(text).toContain("- a: fast-forwarded");
    expect(text).toContain("- b: dirty");
  });

  it("says so plainly when nothing needed moving", () => {
    const text = summarizeWorktreeRefresh([result("a", "up-to-date")]);
    expect(text).toContain("already at its tracked branch");
  });

  it("handles an empty repo list", () => {
    expect(summarizeWorktreeRefresh([])).toBe("No repositories to refresh.");
  });
});
