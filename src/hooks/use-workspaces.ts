"use client";

import useSWR from "swr";
import type { WorkspaceListItem } from "@/types/workspace";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

interface WorkspacesResponse {
  workspaces: WorkspaceListItem[];
  olderCount: number;
  archivedCount: number;
}

export function useWorkspaces(options?: {
  recentOnly?: boolean;
  includeArchived?: boolean;
}) {
  const recentOnly = options?.recentOnly ?? false;
  const includeArchived = options?.includeArchived ?? false;

  const params = new URLSearchParams();
  if (recentOnly) params.set("recentOnly", "true");
  if (includeArchived) params.set("includeArchived", "true");
  const qs = params.toString();
  const key = qs ? `/api/workspaces?${qs}` : "/api/workspaces";

  const { data, error, isLoading, mutate } = useSWR<WorkspacesResponse>(
    key,
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL },
  );

  return {
    workspaces: data?.workspaces ?? [],
    olderCount: data?.olderCount ?? 0,
    archivedCount: data?.archivedCount ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}
