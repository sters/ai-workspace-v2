"use client";

import { useCallback } from "react";
import useSWR from "swr";
import type { WorkspaceSummary, TodoFile, ReviewSession, HistoryEntry } from "@/types/workspace";
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

export function useReviewDetail(name: string, timestamp: string | null) {
  const { data, error, isLoading } = useSWR<{ summary: string; files: { name: string; content: string }[] }>(
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
