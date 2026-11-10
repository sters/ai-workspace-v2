/**
 * Per-clone cache files under `.ai-workspace/<dir>/<repo path>.md`, so a
 * worktree and an aliased worktree of one clone resolve to the same file.
 */

import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getResolvedWorkspaceRoot } from "@/lib/config/resolver";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";
import { repoDir } from "./helpers";
import type { GitExec } from "./git-exec";

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return p;
  }
}

/**
 * The clone `worktreePath` belongs to, as its path under `repositories/`
 * (`github.com/org/repo`), or `null` when it is not a worktree of such a clone.
 * Every worktree of one clone, aliased or not, gets the same key.
 */
export async function cloneKey(worktreePath: string, git: GitExec): Promise<string | null> {
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreePath);
  if (!common.ok || !common.out) return null;

  const cloneDir = await realpathOrSelf(path.dirname(common.out));
  const rel = path.relative(await realpathOrSelf(repoDir()), cloneDir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

export function cloneCachePath(key: string, dir: string): string {
  return path.join(getWorkspaceConfigDir(getResolvedWorkspaceRoot()), dir, `${key}.md`);
}

/** The cache file for the clone `worktreePath` belongs to, or `null` when it has none (see `cloneKey`). */
export async function cloneCacheFile(
  worktreePath: string,
  dir: string,
  git: GitExec,
): Promise<string | null> {
  const key = await cloneKey(worktreePath, git);
  return key ? cloneCachePath(key, dir) : null;
}

/** Write via rename, since two workspaces of one repository may finish discovery together. */
export async function writeCacheFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, file);
}
