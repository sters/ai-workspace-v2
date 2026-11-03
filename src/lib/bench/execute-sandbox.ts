/**
 * A throwaway copy of one repository's execute starting point: the workspace
 * files the executor reads (README, TODO, guidance) and a worktree of the same
 * clone on a throwaway branch at the start commit, so attempts never touch the
 * real worktree or each other.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runGit } from "@/lib/workspace/git-exec";

export interface SandboxInput {
  /** Any worktree of the clone; the sandbox's worktree is added to the same clone. */
  sourceWorktree: string;
  startSha: string;
  /** Created at the start commit and checked out, so the executor commits on a branch as it would in a workspace. */
  branch: string;
  sandboxWsPath: string;
  /** Where the repository sits inside a workspace, e.g. `github.com/org/repo`. */
  repoPath: string;
  /** Workspace-relative path → content. */
  files: Record<string, string>;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await runGit(args, cwd);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.out}`);
  return r.out;
}

/** Returns the sandbox worktree's path. */
export async function prepareSandbox(input: SandboxInput): Promise<string> {
  for (const [rel, content] of Object.entries(input.files)) {
    await Bun.write(path.join(input.sandboxWsPath, rel), content);
  }
  const worktree = path.join(input.sandboxWsPath, input.repoPath);
  await mkdir(path.dirname(worktree), { recursive: true });
  await git(input.sourceWorktree, "worktree", "add", "-q", "-b", input.branch, worktree, input.startSha);
  return worktree;
}

export interface SandboxOutcome {
  commits: string[];
  /** Paths the attempt left uncommitted, tracked or not. */
  uncommitted: string[];
  diffStat: string;
  /** Everything the attempt changed since the start commit, committed or not. */
  patch: string;
}

export async function collectSandboxOutcome(worktree: string, startSha: string): Promise<SandboxOutcome> {
  const log = await git(worktree, "log", "--oneline", `${startSha}..HEAD`);
  const status = await git(worktree, "status", "--porcelain", "--untracked-files=all");
  // Staging is the attempt's own throwaway index; it makes untracked files part of the diff.
  await git(worktree, "add", "-A");
  return {
    commits: log ? log.split("\n") : [],
    uncommitted: status ? status.split("\n").map((l) => l.slice(3)) : [],
    diffStat: await git(worktree, "diff", "--cached", "--stat", startSha),
    patch: await git(worktree, "diff", "--cached", startSha),
  };
}

export async function removeSandbox(sourceWorktree: string, worktree: string, branch: string): Promise<void> {
  await git(sourceWorktree, "worktree", "remove", "--force", worktree);
  await git(sourceWorktree, "branch", "-D", branch);
}

/**
 * The commit the planned TODO was carried out from: the parent of the oldest
 * first-parent commit after `sinceIso`, the plan's snapshot time. Unlike the
 * merge-base, it still holds once the branch has landed in its base. `null`
 * when nothing was committed after the plan.
 */
export async function findPlanStart(worktree: string, sinceIso: string): Promise<string | null> {
  const after = await git(worktree, "log", "--first-parent", "--reverse", "--format=%H", `--since=${sinceIso}`, "HEAD");
  const first = after.split("\n")[0];
  return first ? git(worktree, "rev-parse", `${first}^`) : null;
}
