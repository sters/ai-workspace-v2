/**
 * TTL cache in front of the PR read.
 *
 * Reading the tab costs two `gh` network round trips **per repository** — a `gh
 * pr view` and a GraphQL query — and nothing on the page can render until they
 * both return. SWR revalidates on mount and on focus, so switching tabs, coming
 * back to the browser, or having the page open twice all paid that again for
 * data that changes on the timescale of a human writing a review comment.
 *
 * What is cached is the **promise**, not the value, which buys in-flight
 * coalescing as well as the TTL: two tabs loading at once, or a focus
 * revalidation landing while the first load is still out, share one round trip.
 *
 * The cost of the cache is that a review comment posted seconds ago may not
 * appear for up to `PR_CACHE_TTL_MS`. That is what the tab's Refresh button is
 * for — it forces a read past the cache — and it is why operations never read
 * through here: `validate-pr-comments` resolves thread ids against the live PR
 * precisely so a thread GitHub has since resolved is skipped.
 */

import { listWorkspaceRepos } from "./git";
import { mergeRepoPullRequestReads, readRepoPullRequest } from "./pr-threads";
import type {
  PullRequestProblem,
  RepoPullRequestRead,
  WorkspacePullRequest,
} from "@/types/pull-request";
import type { WorkspaceRepo } from "@/types/workspace";

/**
 * Short enough that a reviewer's comment shows up on the next look, long enough
 * that a focus revalidation costs nothing.
 */
export const PR_CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  promise: Promise<RepoPullRequestRead>;
  storedAt: number;
}

/**
 * Keyed per repository rather than per workspace, so the tab's per-repository
 * requests and a workspace-wide read share one round trip.
 */
const globalForPrCache = globalThis as unknown as {
  __aiwPrCache?: Map<string, CacheEntry>;
};

function cache(): Map<string, CacheEntry> {
  globalForPrCache.__aiwPrCache ??= new Map();
  return globalForPrCache.__aiwPrCache;
}

function cacheKey(workspace: string, repoPath: string): string {
  return `${workspace}\0${repoPath}`;
}

export function getCachedRepoPullRequest(
  workspace: string,
  repo: WorkspaceRepo,
  opts?: { force?: boolean; now?: number },
): Promise<RepoPullRequestRead> {
  const now = opts?.now ?? Date.now();
  const entries = cache();
  const key = cacheKey(workspace, repo.repoPath);

  if (!opts?.force) {
    const hit = entries.get(key);
    if (hit && now - hit.storedAt < PR_CACHE_TTL_MS) return hit.promise;
  }

  const promise = readRepoPullRequest(repo);
  entries.set(key, { promise, storedAt: now });

  // The read resolves its failures as `problems`, so a rejection is unexpected;
  // holding it for the full TTL would keep reporting an error already fixed.
  promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  });

  return promise;
}

export async function getCachedPullRequests(
  workspace: string,
  opts?: { force?: boolean; now?: number },
): Promise<{ pullRequests: WorkspacePullRequest[]; problems: PullRequestProblem[] }> {
  const repos = await listWorkspaceRepos(workspace);
  return mergeRepoPullRequestReads(
    await Promise.all(repos.map((repo) => getCachedRepoPullRequest(workspace, repo, opts))),
  );
}

/** Drop one workspace's entries, or the whole cache when given no workspace. */
export function invalidatePullRequestCache(workspace?: string): void {
  if (workspace === undefined) {
    cache().clear();
    return;
  }
  const prefix = cacheKey(workspace, "");
  for (const key of cache().keys()) {
    if (key.startsWith(prefix)) cache().delete(key);
  }
}

/** Reset for testing. */
export function _resetPrCache(): void {
  globalForPrCache.__aiwPrCache = new Map();
}
