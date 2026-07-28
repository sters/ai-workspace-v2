import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getIncrementalChanges } from "@/lib/workspace/pr";

/**
 * Exercised against real git rather than a mock: the whole point of this helper
 * is which commits a range does and does not include, and that is git's
 * semantics, not ours.
 */
describe("getIncrementalChanges", () => {
  let repo: string;

  function git(...args: string[]): string {
    const result = Bun.spawnSync(["git", "-C", repo, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    });
    if (!result.success) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  }

  function commit(file: string, content: string, message: string): string {
    fs.writeFileSync(path.join(repo, file), content);
    git("add", file);
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join("/tmp", "aiw-incremental-"));
    git("init", "-b", "main");
    commit("base.txt", "base\n", "base commit");
    // A local `origin/main` ref, since the helper compares against one and the
    // real caller has already fetched it.
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-b", "feature");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("returns null for a sha that is not an ancestor of HEAD", () => {
    commit("a.txt", "a\n", "add a");
    // Plausible-looking but absent — the shape a rebase or force-push leaves behind.
    expect(getIncrementalChanges(repo, "main", "0".repeat(40))).toBeNull();
  });

  it("returns null for an empty sha", () => {
    commit("a.txt", "a\n", "add a");
    expect(getIncrementalChanges(repo, "main", "")).toBeNull();
  });

  it("reports only the files changed after the baseline", () => {
    const baseline = commit("a.txt", "a\n", "add a");
    commit("b.txt", "b\n", "add b");

    const inc = getIncrementalChanges(repo, "main", baseline);
    expect(inc).not.toBeNull();
    expect(inc!.changedFiles).toContain("b.txt");
    expect(inc!.changedFiles).not.toContain("a.txt");
    expect(inc!.commitLog).toContain("add b");
    expect(inc!.commitLog).not.toContain("add a");
  });

  it("reports no changes when HEAD has not moved since the baseline", () => {
    const baseline = commit("a.txt", "a\n", "add a");

    const inc = getIncrementalChanges(repo, "main", baseline);
    expect(inc).not.toBeNull();
    expect(inc!.hasChanges).toBe(false);
    expect(inc!.changedFiles.trim()).toBe("");
  });

  // The case that motivated the path restriction: this branch merged origin/main
  // mid-run, which brought 10 other commits into <baseline>..HEAD. Without the
  // restriction the next review's target includes another team's work.
  it("excludes files that arrived only from the base branch via a merge", () => {
    const baseline = commit("a.txt", "a\n", "add a");

    // Advance main with a file the feature branch never touches, then merge it in.
    git("checkout", "main");
    commit("other-team.txt", "theirs\n", "other team's work");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");
    git("merge", "main", "-m", "Merge main");

    const inc = getIncrementalChanges(repo, "main", baseline);
    expect(inc).not.toBeNull();
    expect(inc!.changedFiles).not.toContain("other-team.txt");
    expect(inc!.commitLog).not.toContain("other team's work");
  });

  it("still reports the branch's own post-merge work", () => {
    const baseline = commit("a.txt", "a\n", "add a");

    git("checkout", "main");
    commit("other-team.txt", "theirs\n", "other team's work");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");
    git("merge", "main", "-m", "Merge main");
    commit("c.txt", "c\n", "add c after merge");

    const inc = getIncrementalChanges(repo, "main", baseline);
    expect(inc!.changedFiles).toContain("c.txt");
    expect(inc!.changedFiles).not.toContain("other-team.txt");
    expect(inc!.commitLog).toContain("add c after merge");
  });

  it("includes a file the branch owns even when the merge also touched it", () => {
    const baseline = commit("shared.txt", "branch\n", "branch edits shared");

    git("checkout", "main");
    fs.writeFileSync(path.join(repo, "shared.txt"), "main\n");
    git("add", "shared.txt");
    git("commit", "-m", "main edits shared");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");
    // Resolve in favour of the branch so the merge produces a real change.
    Bun.spawnSync(["git", "-C", repo, "merge", "main", "-m", "Merge main"], { stdout: "pipe", stderr: "pipe" });
    fs.writeFileSync(path.join(repo, "shared.txt"), "resolved\n");
    git("add", "shared.txt");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "resolve conflict");

    const inc = getIncrementalChanges(repo, "main", baseline);
    expect(inc!.changedFiles).toContain("shared.txt");
  });
});
