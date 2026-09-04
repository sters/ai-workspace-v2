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
import { buildDiscoverConstraintsPhase } from "./discover-constraints";
import type { PhaseFunctionContext } from "@/types/pipeline";

export interface SyncReadmeReposResult {
  /** Number of repositories declared in the README. */
  metaRepoCount: number;
  /** Number of worktrees already on disk before setup ran. */
  existingCount: number;
  /** Repo paths newly set up during this run. */
  setUp: string[];
  /**
   * The `setUp` paths resolved to their on-disk worktrees. Follow-on setup work
   * (constraint discovery) needs the repo name and worktree path, which only
   * the post-setup listing knows.
   */
  setUpRepos: { repoName: string; worktreePath: string }[];
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
      setUpRepos: [],
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
      setUpRepos: [],
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

  const after = listWorkspaceRepos(workspace);
  const afterPaths = new Set(after.map((r) => r.repoPath));
  const setUp = missing.filter((r) => afterPaths.has(r.path)).map((r) => r.path);
  const setUpPaths = new Set(setUp);
  return {
    metaRepoCount: metaRepos.length,
    existingCount: existing.length,
    setUp,
    setUpRepos: after
      .filter((r) => setUpPaths.has(r.repoPath))
      .map((r) => ({ repoName: r.repoName, worktreePath: r.worktreePath })),
    stillMissing: metaRepos.filter((r) => !afterPaths.has(r.path)).map((r) => r.path),
  };
}

/**
 * Discover lint/test/build constraints for worktrees that were just created.
 *
 * The discovery phase itself only runs on the init path, so a repository added
 * to an existing workspace reached review with its commands undeclared — which
 * `buildNoConstraintsReport` reports as `NOT DECLARED` and nothing else runs.
 * Callers treat a `false` return as incomplete, never as fatal: the executor
 * resolves its own toolchain and runs the repo's commands regardless.
 */
export async function discoverConstraintsForNewRepos(
  ctx: PhaseFunctionContext,
  workspace: string,
  repos: { repoName: string; worktreePath: string }[],
): Promise<boolean> {
  if (repos.length === 0) return true;
  return buildDiscoverConstraintsPhase({
    workspace,
    wsPath: path.join(getWorkspaceDir(), workspace),
    repos,
  }).fn(ctx);
}
