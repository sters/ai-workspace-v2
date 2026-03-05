import useSWR from "swr";
import type { WorkspaceSummary } from "@/types/workspace";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
