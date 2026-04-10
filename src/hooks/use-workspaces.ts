"use client";

import useSWR from "swr";
import type { WorkspaceListItem } from "@/types/workspace";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

interface WorkspacesResponse {
  workspaces: WorkspaceListItem[];
  olderCount: number;
}

export function useWorkspaces(options?: { recentOnly?: boolean }) {
  const recentOnly = options?.recentOnly ?? false;
  const key = recentOnly
    ? "/api/workspaces?recentOnly=true"
    : "/api/workspaces";

  const { data, error, isLoading, mutate } = useSWR<WorkspacesResponse>(
    key,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL },
  );

  return {
    workspaces: data?.workspaces ?? [],
    olderCount: data?.olderCount ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}
