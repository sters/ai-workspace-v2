// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectSandboxOutcome, prepareSandbox, removeSandbox } from "@/lib/bench/execute-sandbox";
import { runGit } from "@/lib/workspace/git-exec";

async function git(cwd: string, ...args: string[]) {
  const r = await runGit(args, cwd);
  if (!r.ok) throw new Error(r.out);
  return r.out;
}

let tmp: string;
let worktree: string;
let firstSha: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "bench-exec-"));
  worktree = path.join(tmp, "repo");
  await git(tmp, "init", "-q", "-b", "main", worktree);
  await git(worktree, "config", "user.email", "t@example.com");
  await git(worktree, "config", "user.name", "t");
  await writeFile(path.join(worktree, "a.txt"), "one\n");
  await git(worktree, "add", "-A");
  await git(worktree, "commit", "-qm", "first");
  firstSha = await git(worktree, "rev-parse", "HEAD");
  await writeFile(path.join(worktree, "a.txt"), "two\n");
  await git(worktree, "commit", "-qam", "second");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("execute bench sandbox", () => {
  it("checks the repository out at the start commit beside the workspace files, leaving the real worktree alone", async () => {
    const sandbox = path.join(tmp, "sandbox");
    const sandboxWorktree = await prepareSandbox({
      sourceWorktree: worktree,
      startSha: firstSha,
      branch: "bench-a",
      sandboxWsPath: sandbox,
      repoPath: "github.com/org/repo",
      files: { "README.md": "# readme", "TODO-repo.md": "- [ ] do it" },
    });

    expect(sandboxWorktree).toBe(path.join(sandbox, "github.com/org/repo"));
    expect(await readFile(path.join(sandboxWorktree, "a.txt"), "utf8")).toBe("one\n");
    expect(await readFile(path.join(sandbox, "TODO-repo.md"), "utf8")).toBe("- [ ] do it");
    expect(await readFile(path.join(worktree, "a.txt"), "utf8")).toBe("two\n");
  });

  it("reports the attempt's commits and a patch that includes files it left uncommitted or untracked", async () => {
    const sandbox = path.join(tmp, "sandbox");
    const wt = await prepareSandbox({ sourceWorktree: worktree, startSha: firstSha, branch: "bench-a", sandboxWsPath: sandbox, repoPath: "repo", files: {} });
    await writeFile(path.join(wt, "a.txt"), "changed\n");
    await git(wt, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qam", "attempt commit");
    await writeFile(path.join(wt, "new.txt"), "untracked\n");

    const outcome = await collectSandboxOutcome(wt, firstSha);

    expect(outcome.commits).toEqual([expect.stringContaining("attempt commit")]);
    expect(outcome.patch).toContain("+changed");
    expect(outcome.patch).toContain("+untracked");
    expect(outcome.uncommitted).toEqual(["new.txt"]);
    expect(outcome.diffStat).toContain("2 files changed");
  });

  it("removes the sandbox's worktree and branch from the clone", async () => {
    const sandbox = path.join(tmp, "sandbox");
    const wt = await prepareSandbox({ sourceWorktree: worktree, startSha: firstSha, branch: "bench-a", sandboxWsPath: sandbox, repoPath: "repo", files: {} });
    await writeFile(path.join(wt, "dirty.txt"), "x\n");

    await removeSandbox(worktree, wt, "bench-a");

    expect(await git(worktree, "worktree", "list")).not.toContain(wt);
    expect(await git(worktree, "branch", "--list", "bench-a")).toBe("");
  });
});
