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

import { listWorkspacePullRequests } from "./pr-threads";
import type { PullRequestProblem, WorkspacePullRequest } from "@/types/pull-request";

/**
 * Short enough that a reviewer's comment shows up on the next look, long enough
 * that a focus revalidation costs nothing.
 */
export const PR_CACHE_TTL_MS = 60 * 1000;

interface PullRequestRead {
  pullRequests: WorkspacePullRequest[];
  problems: PullRequestProblem[];
}

interface CacheEntry {
  promise: Promise<PullRequestRead>;
  storedAt: number;
}

const globalForPrCache = globalThis as unknown as {
  __aiwPrCache?: Map<string, CacheEntry>;
};

function cache(): Map<string, CacheEntry> {
  globalForPrCache.__aiwPrCache ??= new Map();
  return globalForPrCache.__aiwPrCache;
}

export function getCachedPullRequests(
  workspace: string,
  opts?: { force?: boolean; now?: number },
): Promise<PullRequestRead> {
  const now = opts?.now ?? Date.now();
  const entries = cache();

  if (!opts?.force) {
    const hit = entries.get(workspace);
    if (hit && now - hit.storedAt < PR_CACHE_TTL_MS) return hit.promise;
  }

  const promise = listWorkspacePullRequests(workspace);
  entries.set(workspace, { promise, storedAt: now });

  // A rejection here means the workspace itself could not be listed — per-repo
  // failures resolve as `problems` instead. Holding it for the full TTL would
  // keep reporting an error the user has already fixed.
  promise.catch(() => {
    if (entries.get(workspace)?.promise === promise) entries.delete(workspace);
  });

  return promise;
}

/** Drop one workspace's entry, or the whole cache when given no workspace. */
export function invalidatePullRequestCache(workspace?: string): void {
  if (workspace === undefined) cache().clear();
  else cache().delete(workspace);
}

/** Reset for testing. */
export function _resetPrCache(): void {
  globalForPrCache.__aiwPrCache = new Map();
}
