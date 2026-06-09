/**
 * Pipeline action: reconcile the repository list declared in a workspace's
 * README.md with the git worktrees actually present on disk, setting up any
 * that are missing. Shared by the autonomous "Ensure repositories" salvage
 * phase and the update-readme follow-on phase.
 */

import path from "node:path";
import { getWorkspaceDir } from "@/lib/config";
import { listWorkspaceRepos } from "@/lib/workspace/git";
import { readWorkspaceReadme, denormalizeRepoPath } from "@/lib/parsers/readme";
import { setupRepository } from "./setup-repository";

export interface SyncReadmeReposResult {
  /** Number of repositories declared in the README. */
  metaRepoCount: number;
  /** Number of worktrees already on disk before setup ran. */
  existingCount: number;
  /** Repo paths newly set up during this run. */
  setUp: string[];
  /** README repo paths still absent after the setup attempt (failed or skipped). */
  stillMissing: string[];
  /** Set when the README could not be read; no setup is attempted in that case. */
  readError?: string;
}

/**
 * Set up any repositories listed in the workspace README that don't yet have a
 * worktree on disk. Best-effort: individual setup failures are reported via
 * `stillMissing` rather than thrown, so callers decide how to treat them.
 */
export async function syncReadmeRepositories(
  workspace: string,
  emitStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<SyncReadmeReposResult> {
  const wsPath = path.join(getWorkspaceDir(), workspace);

  let metaRepos: { alias: string; path: string; baseBranch: string }[];
  try {
    const { meta } = await readWorkspaceReadme(wsPath);
    metaRepos = meta.repositories;
  } catch (err) {
    return {
      metaRepoCount: 0,
      existingCount: listWorkspaceRepos(workspace).length,
      setUp: [],
      stillMissing: [],
      readError: String(err),
    };
  }

  const existing = listWorkspaceRepos(workspace);
  const existingPaths = new Set(existing.map((r) => r.repoPath));
  const missing = metaRepos.filter((r) => !existingPaths.has(r.path));

  if (missing.length === 0) {
    return {
      metaRepoCount: metaRepos.length,
      existingCount: existing.length,
      setUp: [],
      stillMissing: [],
    };
  }

  emitStatus(
    `Setting up ${missing.length} missing repositor${missing.length === 1 ? "y" : "ies"} from README`,
  );
  for (const repo of missing) {
    if (signal?.aborted) break;
    emitStatus(`Setting up repository: ${repo.path}`);
    try {
      setupRepository(
        workspace,
        denormalizeRepoPath(repo.path),
        repo.baseBranch,
        emitStatus,
      );
    } catch (err) {
      emitStatus(`Warning: Failed to set up ${repo.path}: ${err}`);
    }
  }

  const afterPaths = new Set(listWorkspaceRepos(workspace).map((r) => r.repoPath));
  return {
    metaRepoCount: metaRepos.length,
    existingCount: existing.length,
    setUp: missing.filter((r) => afterPaths.has(r.path)).map((r) => r.path),
    stillMissing: metaRepos.filter((r) => !afterPaths.has(r.path)).map((r) => r.path),
  };
}
