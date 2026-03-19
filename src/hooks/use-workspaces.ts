import useSWR from "swr";
import type { WorkspaceSummary } from "@/types/workspace";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

export function useWorkspaces() {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceSummary[]>(
    "/api/workspaces",
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL }
  );

  return {
    workspaces: data ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
