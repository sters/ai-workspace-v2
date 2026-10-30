"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type {
  WorkspaceSummary,
  TodoFile,
  ReviewSession,
  ReviewFileRef,
  HistoryEntry,
} from "@/types/workspace";
import type { ArtifactFileContent, ArtifactListing } from "@/types/artifact";
import type { FileDiff, WorkspaceChanges } from "@/types/changes";
import type {
  PullRequestProblem,
  RepoPullRequestRead,
  WorkspacePullRequest,
  WorkspacePullRequestRepos,
} from "@/types/pull-request";
import type { ReviewFindingsResult } from "@/types/review-findings";
import type { ReviewFreshnessResult } from "@/types/review-freshness";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

export function useWorkspace(name: string) {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceSummary>(
    name ? `/api/workspaces/${encodeURIComponent(name)}` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return { workspace: data, isLoading, error, refresh: mutate };
}

export function useMemoContent(name: string) {
  const { data, error, isLoading, mutate } = useSWR<{ content: string }>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/memo` : null,
    fetcher,
  );

  return { content: data?.content ?? "", isLoading, error, refresh: mutate };
}

export function useReadme(name: string) {
  const { data, error, isLoading } = useSWR<string>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/readme` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      return r.text();
    },
  );

  return { readme: data ?? "", isLoading, error };
}

export function useTodos(name: string) {
  const { data, error, isLoading } = useSWR<TodoFile[]>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/todos` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return { todos: data ?? [], isLoading, error };
}

export function useReviews(name: string) {
  const { data, error, isLoading } = useSWR<ReviewSession[]>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/reviews` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return { reviews: data ?? [], isLoading, error };
}

/**
 * The PRs on this workspace's branches, with their review threads, CI state and
 * any recorded validation verdicts.
 *
 * Deliberately not on `SWR_REFRESH_INTERVAL`: a cold read costs two `gh` network
 * round trips per repository. The server holds a short TTL cache in front of
 * that, so the revalidations SWR does on mount and on focus are nearly free —
 * but a timer would still keep re-rendering for data that changes at the pace of
 * a human writing a review.
 *
 * `refresh` is the deliberate one: it asks past the server cache, which is the
 * only way to see a comment or a CI result from seconds ago.
 */
export interface RepoPullRequestState extends RepoPullRequestRead {
  repoName: string;
  repoPath: string;
  /** Whether its first read is still out — a re-read keeps showing the last one. */
  isLoading: boolean;
}

/**
 * The repositories first, then one request per repository, all at once, so
 * each PR renders as its `gh` round trips return instead of with the slowest.
 * Every revalidation of the repository list (mount, focus, Refresh) re-reads
 * the repositories; the server's TTL cache makes the unforced ones free.
 */
export function usePullRequests(name: string) {
  const url = name ? `/api/workspaces/${encodeURIComponent(name)}/pull-requests` : null;
  const [loaded, setLoaded] = useState<{ url: string | null; reads: Record<string, RepoPullRequestRead> }>({
    url,
    reads: {},
  });
  const forceNext = useRef(false);
  // A newer round of reads supersedes the one still out.
  const generation = useRef(0);

  const loadRepos = useCallback(
    (repos: WorkspacePullRequestRepos["repos"], force: boolean) => {
      if (!url) return;
      const gen = ++generation.current;
      for (const repo of repos) {
        const query = new URLSearchParams({ repo: repo.repoPath });
        if (force) query.set("refresh", "1");
        (fetcher(`${url}?${query}`) as Promise<RepoPullRequestRead>)
          .catch((err): RepoPullRequestRead => ({
            problem: { repoName: repo.repoName, reason: err instanceof Error ? err.message : String(err) },
          }))
          .then((read) => {
            if (gen !== generation.current) return;
            setLoaded((prev) => ({
              url,
              reads: { ...(prev.url === url ? prev.reads : {}), [repo.repoPath]: read },
            }));
          });
      }
    },
    [url],
  );

  const { data, error, isLoading, mutate } = useSWR<WorkspacePullRequestRepos>(url, fetcher, {
    onSuccess: (list) => {
      const force = forceNext.current;
      forceNext.current = false;
      loadRepos(list.repos, force);
    },
  });

  const refresh = useCallback(() => {
    forceNext.current = true;
    return mutate();
  }, [mutate]);

  const reads = loaded.url === url ? loaded.reads : undefined;
  const { repos, pullRequests, problems } = useMemo(() => {
    const repos: RepoPullRequestState[] = (data?.repos ?? []).map((repo) => ({
      ...repo,
      ...reads?.[repo.repoPath],
      isLoading: !reads || !(repo.repoPath in reads),
    }));
    return {
      repos,
      pullRequests: repos.flatMap((r): WorkspacePullRequest[] => (r.pr ? [r.pr] : [])),
      problems: repos.flatMap((r): PullRequestProblem[] => (r.problem ? [r.problem] : [])),
    };
  }, [data, reads]);

  return {
    repos,
    pullRequests,
    problems,
    validations: data?.validations ?? {},
    isLoading,
    error,
    refresh,
  };
}

/**
 * A review's structured findings, resolved against the PR they would be posted to.
 *
 * `revalidateOnFocus` is off because this read costs `gh` round trips and a
 * `git diff` per repository, and it changes at the pace of a human reading a
 * review — the tab has a Refresh button for the rest.
 */
export function useReviewFindings(name: string, timestamp: string | null) {
  const url =
    name && timestamp
      ? `/api/workspaces/${encodeURIComponent(name)}/reviews/${timestamp}/findings`
      : null;
  const { data, error, isLoading, mutate } = useSWR<ReviewFindingsResult>(url, fetcher, {
    revalidateOnFocus: false,
  });

  return {
    repos: data?.repos ?? [],
    groundings: data?.groundings ?? {},
    isLoading,
    error,
    refresh: useCallback(() => mutate(), [mutate]),
  };
}

/**
 * Whether each repository's PR has moved since the last review judged it.
 *
 * Same read profile as `usePullRequests` — it shares that read's server-side TTL
 * cache — so no timer and no focus revalidation: a PR moves when a human
 * pushes, and the answer is only acted on by clicking Re-review.
 */
export function useReviewFreshness(name: string) {
  const url = name ? `/api/workspaces/${encodeURIComponent(name)}/review-freshness` : null;
  const { data, error, isLoading, mutate } = useSWR<ReviewFreshnessResult>(url, fetcher, {
    revalidateOnFocus: false,
  });

  const refresh = useCallback(
    () => (url ? mutate(fetcher(`${url}?refresh=1`)) : mutate()),
    [url, mutate],
  );

  return {
    repos: data?.repos ?? [],
    anyUpdatedSinceReview: data?.anyUpdatedSinceReview ?? false,
    isLoading,
    error,
    refresh,
  };
}

export function useHistory(name: string) {
  const { data, error, isLoading, mutate } = useSWR<{ entries: HistoryEntry[]; hasMore: boolean }>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/history` : null,
    fetcher
  );

  const loadMore = useCallback(async () => {
    if (!data || !data.hasMore) return;
    const skip = data.entries.length;
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(name)}/history?skip=${skip}`
    );
    if (!res.ok) return;
    const page: { entries: HistoryEntry[]; hasMore: boolean } = await res.json();
    await mutate(
      { entries: [...data.entries, ...page.entries], hasMore: page.hasMore },
      { revalidate: false }
    );
  }, [data, name, mutate]);

  return {
    history: data?.entries ?? [],
    hasMore: data?.hasMore ?? false,
    isLoading,
    error,
    loadMore,
  };
}

export function useResearchReport(name: string) {
  const { data, error, isLoading } = useSWR<{ summary: string; files: { name: string; content: string }[] }>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/research` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return {
    summary: data?.summary ?? "",
    files: data?.files ?? [],
    isLoading,
    error,
  };
}

export function useArtifacts(name: string) {
  const { data, error, isLoading, mutate } = useSWR<ArtifactListing>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/artifacts` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return {
    entries: data?.entries ?? [],
    truncated: data?.truncated ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
}

/**
 * One artifact's content. A running operation rewrites these files, so this
 * follows the same refresh interval as the listing rather than reading once.
 */
export function useArtifactFile(name: string, filePath: string | null) {
  const { data, error, isLoading } = useSWR<ArtifactFileContent>(
    name && filePath
      ? `/api/workspaces/${encodeURIComponent(name)}/artifacts/file?path=${encodeURIComponent(filePath)}`
      : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return { file: data, isLoading, error };
}

/** Each worktree's changed files against its base branch. */
export function useWorkspaceChanges(name: string) {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceChanges>(
    name ? `/api/workspaces/${encodeURIComponent(name)}/changes` : null,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL },
  );

  return { repos: data?.repos ?? [], isLoading, error, refresh: mutate };
}

/**
 * One changed file's diff. Not on an interval or on focus: a revalidation
 * replaces the editor's content, which drops the selection the user may be in
 * the middle of making. `version` is what re-reads it instead — the file's line
 * counts from the listing, which move when the file does.
 */
export function useWorkspaceChangeDiff(
  name: string,
  repoPath: string | null,
  filePath: string | null,
  version: string,
) {
  const { data, error, isLoading, mutate } = useSWR<FileDiff>(
    name && repoPath && filePath
      ? `/api/workspaces/${encodeURIComponent(name)}/changes/diff?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(filePath)}&v=${encodeURIComponent(version)}`
      : null,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  return { diff: data, isLoading, error, refresh: mutate };
}

/**
 * A review session's summary and the names of its per-repo reports. The reports
 * themselves are read one at a time through `useArtifactFile`, when opened.
 */
export function useReviewDetail(name: string, timestamp: string | null) {
  const { data, error, isLoading } = useSWR<{ summary: string; files: ReviewFileRef[] }>(
    name && timestamp
      ? `/api/workspaces/${encodeURIComponent(name)}/reviews/${timestamp}`
      : null,
    fetcher
  );

  return {
    summary: data?.summary,
    files: data?.files,
    isLoading,
    error,
  };
}
