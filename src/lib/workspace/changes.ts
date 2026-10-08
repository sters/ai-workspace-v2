/**
 * Each worktree's change against its base branch, for the Changes tab.
 *
 * The comparison is the working tree against `merge-base(origin/<base>, HEAD)`
 * rather than `origin/<base>...HEAD`: a workspace is mostly looked at while an
 * executor or a chat is still editing it, and a commits-only view would hide
 * exactly the work in progress. Untracked files are listed too, for the same
 * reason — a new file is untracked until someone commits it.
 *
 * Nothing here fetches. The base is `origin/<base>` as last fetched, which is
 * what every worktree was cut from; a listing that talked to the remote on
 * every page load would be the slow part of the page.
 */

import { pathExists } from "@/lib/fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceDir } from "../config";
import { runProcess } from "../process/run";
import { parseReadmeMeta } from "../parsers/readme";
import { CHANGES_DIFF_MAX_BYTES } from "../constants";
import { listWorkspaceRepos } from "./git";
import { localBaseBranch, remoteBranchExists } from "./helpers";
import type {
  ChangedFile,
  ChangedFileStatus,
  FileDiff,
  RepoChangeSet,
} from "@/types/changes";

/** An untracked file past this is not read to count its lines. */
const UNTRACKED_COUNT_MAX_BYTES = 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  const result = await runProcess(["git", "-C", cwd, ...args]);
  return {
    code: result.exitCode,
    out: result.success ? result.stdout : result.stdout || result.stderr,
  };
}

const NAME_STATUS: Record<string, ChangedFileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  T: "modified",
};

/** `--name-status -z`: `X\0path\0`, or `R<score>\0old\0new\0` for a rename. */
function parseNameStatus(out: string): { path: string; oldPath?: string; status: ChangedFileStatus }[] {
  const tokens = out.split("\0");
  const entries: { path: string; oldPath?: string; status: ChangedFileStatus }[] = [];
  for (let i = 0; i < tokens.length; ) {
    const code = tokens[i];
    if (!code) break;
    const status = NAME_STATUS[code[0]] ?? "modified";
    if (code[0] === "R" || code[0] === "C") {
      entries.push({ oldPath: tokens[i + 1], path: tokens[i + 2], status });
      i += 3;
    } else {
      entries.push({ path: tokens[i + 1], status });
      i += 2;
    }
  }
  return entries;
}

/**
 * `--numstat -z`: `add\tdel\tpath\0`, or `add\tdel\t\0old\0new\0` for a
 * rename. A binary file counts as `-\t-`.
 */
function parseNumstat(out: string): Map<string, { additions: number | null; deletions: number | null }> {
  const tokens = out.split("\0");
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let i = 0; i < tokens.length; ) {
    const head = tokens[i];
    if (!head) break;
    const [add, del, inlinePath] = head.split("\t");
    let filePath = inlinePath;
    i += 1;
    if (inlinePath === "") {
      filePath = tokens[i + 1];
      i += 2;
    }
    counts.set(filePath, {
      additions: add === "-" ? null : Number(add),
      deletions: del === "-" ? null : Number(del),
    });
  }
  return counts;
}

async function countUntrackedLines(absPath: string): Promise<number | null> {
  try {
    if ((await stat(absPath)).size > UNTRACKED_COUNT_MAX_BYTES) return null;
    const content = await readFile(absPath);
    if (content.includes(0)) return null;
    const text = content.toString("utf8");
    if (text === "") return 0;
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return null;
  }
}

async function resolveMergeBase(
  worktreePath: string,
  baseBranch: string,
): Promise<{ baseSha: string } | { error: string }> {
  const mergeBase = await git(worktreePath, ["merge-base", `origin/${baseBranch}`, "HEAD"]);
  if (mergeBase.code !== 0) {
    return { error: `origin/${baseBranch} could not be compared with HEAD: ${mergeBase.out.trim()}` };
  }
  return { baseSha: mergeBase.out.trim() };
}

/** The files a worktree changes against `origin/<baseBranch>`, sorted by path. */
export async function listRepoChanges(
  worktreePath: string,
  baseBranch: string,
): Promise<{ baseSha: string; files: ChangedFile[] } | { error: string }> {
  const base = await resolveMergeBase(worktreePath, baseBranch);
  if ("error" in base) return base;
  const { baseSha } = base;

  const [nameStatus, numstat, untracked] = await Promise.all([
    git(worktreePath, ["diff", "-z", "-M", "--name-status", baseSha]),
    git(worktreePath, ["diff", "-z", "-M", "--numstat", baseSha]),
    git(worktreePath, ["ls-files", "-z", "--others", "--exclude-standard"]),
  ]);
  if (nameStatus.code !== 0 || numstat.code !== 0) {
    return { error: (nameStatus.code !== 0 ? nameStatus : numstat).out.trim() };
  }
  const counts = parseNumstat(numstat.out);

  const files: ChangedFile[] = parseNameStatus(nameStatus.out).map((entry) => ({
    ...entry,
    ...(counts.get(entry.path) ?? { additions: null, deletions: null }),
  }));

  if (untracked.code === 0) {
    const untrackedPaths = untracked.out.split("\0").filter(Boolean);
    const lineCounts = await Promise.all(
      untrackedPaths.map((filePath) => countUntrackedLines(path.join(worktreePath, filePath))),
    );
    untrackedPaths.forEach((filePath, i) => {
      files.push({ path: filePath, status: "untracked", additions: lineCounts[i], deletions: 0 });
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { baseSha, files };
}

/**
 * The listing entry for one path, without the line counts the full listing
 * reads — the diff route asks this once per file the viewer scrolls to.
 */
async function findChangedFile(
  worktreePath: string,
  baseSha: string,
  filePath: string,
): Promise<{ path: string; oldPath?: string; status: ChangedFileStatus } | null> {
  // Over the whole tree rather than `-- <path>`: a pathspec of the new name
  // alone hides the old one, and the rename then reads as an addition.
  const nameStatus = await git(worktreePath, ["diff", "-z", "-M", "--name-status", baseSha]);
  if (nameStatus.code !== 0) return null;
  const tracked = parseNameStatus(nameStatus.out).find((entry) => entry.path === filePath);
  if (tracked) return tracked;

  const untracked = await git(worktreePath, [
    "ls-files", "-z", "--others", "--exclude-standard", "--", filePath,
  ]);
  if (untracked.code !== 0) return null;
  return untracked.out.split("\0").includes(filePath) ? { path: filePath, status: "untracked" } : null;
}

/**
 * One changed file's unified diff. `null` for a path that is not one of the
 * listed changes — that lookup is what keeps a caller-supplied path from
 * naming anything else, since an untracked file's diff is read off disk.
 */
export async function readRepoFileDiff(
  worktreePath: string,
  baseBranch: string,
  filePath: string,
): Promise<FileDiff | null> {
  const base = await resolveMergeBase(worktreePath, baseBranch);
  if ("error" in base) return null;
  const file = await findChangedFile(worktreePath, base.baseSha, filePath);
  if (!file) return null;

  const result =
    file.status === "untracked"
      ? // Exit 1 is "the files differ", which is always the case against /dev/null.
        await git(worktreePath, ["diff", "--no-index", "--", "/dev/null", file.path])
      : await git(worktreePath, [
          "diff",
          "-M",
          base.baseSha,
          "--",
          ...(file.oldPath ? [file.oldPath] : []),
          file.path,
        ]);
  if (result.code !== 0 && !(file.status === "untracked" && result.code === 1)) return null;

  const truncated = result.out.length > CHANGES_DIFF_MAX_BYTES;
  return { diff: truncated ? result.out.slice(0, CHANGES_DIFF_MAX_BYTES) : result.out, truncated };
}

/**
 * The base branch a worktree is compared against: the README's declaration
 * when it names a ref that exists, which is what review and create-pr use,
 * else what the refs on disk say. A declaration naming a missing ref is a
 * README typo (`main` for a `master` repository), and an error in its place
 * would hide the one repository's changes over it.
 */
async function resolveBaseBranch(
  declared: { alias: string; path: string; baseBranch: string }[],
  repo: { repoPath: string; repoName: string; worktreePath: string },
): Promise<string> {
  const meta = declared.find((r) => r.path === repo.repoPath || r.alias === repo.repoName);
  if (meta?.baseBranch && (await remoteBranchExists(repo.worktreePath, meta.baseBranch))) {
    return meta.baseBranch;
  }
  return localBaseBranch(repo.worktreePath);
}

async function readDeclaredRepositories(workspaceName: string) {
  const readme = path.join(getWorkspaceDir(), workspaceName, "README.md");
  if (!(await pathExists(readme))) return [];
  return parseReadmeMeta(await readFile(readme, "utf8")).repositories;
}

export async function listWorkspaceChanges(workspaceName: string): Promise<RepoChangeSet[]> {
  const declared = await readDeclaredRepositories(workspaceName);
  return Promise.all((await listWorkspaceRepos(workspaceName)).map(async (repo): Promise<RepoChangeSet> => {
    const baseBranch = await resolveBaseBranch(declared, repo);
    const base = { repoPath: repo.repoPath, repoName: repo.repoName, baseBranch };
    if (!baseBranch) {
      return { ...base, baseSha: null, files: [], error: "Could not determine the base branch." };
    }
    const listing = await listRepoChanges(repo.worktreePath, baseBranch);
    return "error" in listing
      ? { ...base, baseSha: null, files: [], error: listing.error }
      : { ...base, baseSha: listing.baseSha, files: listing.files };
  }));
}

/** `null` when `repoPath` is not one of the workspace's worktrees. */
export async function readWorkspaceFileDiff(
  workspaceName: string,
  repoPath: string,
  filePath: string,
): Promise<FileDiff | null> {
  const repo = (await listWorkspaceRepos(workspaceName)).find((r) => r.repoPath === repoPath);
  if (!repo) return null;
  const baseBranch = await resolveBaseBranch(await readDeclaredRepositories(workspaceName), repo);
  if (!baseBranch) return null;
  return readRepoFileDiff(repo.worktreePath, baseBranch, filePath);
}
