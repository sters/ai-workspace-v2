import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { listRepoChanges, readRepoFileDiff } from "@/lib/workspace/changes";

/**
 * Against real git: what counts as "this branch's change" is a question of
 * which commits and which working-tree states a comparison includes, and that
 * is git's semantics rather than ours.
 */
describe("repository changes against the base branch", () => {
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

  function write(file: string, content: string) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  }

  function commit(file: string, content: string, message: string) {
    write(file, content);
    git("add", file);
    git("commit", "-m", message);
  }

  beforeEach(async () => {
    repo = fs.mkdtempSync(path.join("/tmp", "aiw-changes-"));
    git("init", "-b", "main");
    commit("keep.txt", "one\ntwo\nthree\n", "base");
    commit("gone.txt", "bye\n", "base 2");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-b", "feature");
  });

  afterEach(async () => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  async function paths() {
    const result = await listRepoChanges(repo, "main");
    if ("error" in result) throw new Error(result.error);
    return result.files.map((f) => `${f.status}:${f.path}`).sort();
  }

  it("includes committed, uncommitted and untracked work", async () => {
    commit("src/committed.ts", "a\n", "feature commit");
    write("keep.txt", "one\nTWO\nthree\n");
    write("src/untracked.ts", "x\ny\n");

    expect(await paths()).toEqual([
      "added:src/committed.ts",
      "modified:keep.txt",
      "untracked:src/untracked.ts",
    ]);
  });

  it("leaves out what the base gained after the branch was cut", async () => {
    commit("mine.txt", "m\n", "feature commit");
    // The base moves on: a three-dot comparison must not show its commit as
    // this branch deleting the file.
    git("checkout", "main");
    commit("theirs.txt", "t\n", "base moved");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");

    expect(await paths()).toEqual(["added:mine.txt"]);
  });

  it("reports deletions and renames with their old path", async () => {
    git("rm", "-q", "gone.txt");
    git("mv", "keep.txt", "kept.txt");
    git("commit", "-m", "move things");

    const result = await listRepoChanges(repo, "main");
    if ("error" in result) throw new Error(result.error);
    const renamed = result.files.find((f) => f.status === "renamed");
    expect(renamed).toMatchObject({ path: "kept.txt", oldPath: "keep.txt" });
    expect(result.files.find((f) => f.path === "gone.txt")?.status).toBe("deleted");
  });

  it("counts lines per file", async () => {
    write("keep.txt", "one\nTWO\nthree\nfour\n");
    write("new.txt", "a\nb\nc\n");

    const result = await listRepoChanges(repo, "main");
    if ("error" in result) throw new Error(result.error);
    expect(result.files.find((f) => f.path === "keep.txt")).toMatchObject({ additions: 2, deletions: 1 });
    expect(result.files.find((f) => f.path === "new.txt")).toMatchObject({ additions: 3, deletions: 0 });
  });

  it("reports an error rather than an empty list when the base ref is missing", async () => {
    const result = await listRepoChanges(repo, "develop");
    expect("error" in result && result.error).toContain("origin/develop");
  });

  it("reads the diff of a tracked file, uncommitted edits included", async () => {
    write("keep.txt", "one\nTWO\nthree\n");
    const diff = await readRepoFileDiff(repo, "main", "keep.txt");
    expect(diff?.diff).toContain("-two");
    expect(diff?.diff).toContain("+TWO");
  });

  it("reads a renamed file's diff as a rename, not as an addition", async () => {
    git("mv", "keep.txt", "kept.txt");
    write("kept.txt", "one\ntwo\nTHREE\n");
    git("add", "kept.txt");
    const diff = (await readRepoFileDiff(repo, "main", "kept.txt"))?.diff ?? "";
    expect(diff).toContain("rename from keep.txt");
    expect(diff).toContain("+THREE");
    expect(diff).not.toContain("+one");
  });

  it("reads the diff of an untracked file as an addition", async () => {
    write("fresh.txt", "hello\n");
    expect((await readRepoFileDiff(repo, "main", "fresh.txt"))?.diff).toContain("+hello");
  });

  it("refuses a path that is not one of the changes", async () => {
    // Unchanged files and paths outside the worktree are both unreadable here:
    // the untracked-file diff reads straight from disk, so without this check a
    // `..` path would read anything the server can.
    fs.writeFileSync(path.join(path.dirname(repo), "aiw-changes-outside.txt"), "secret\n");
    try {
      expect(await readRepoFileDiff(repo, "main", "gone.txt")).toBeNull();
      expect(await readRepoFileDiff(repo, "main", "../aiw-changes-outside.txt")).toBeNull();
    } finally {
      fs.rmSync(path.join(path.dirname(repo), "aiw-changes-outside.txt"), { force: true });
    }
  });
});
