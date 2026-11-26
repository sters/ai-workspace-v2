import useSWR from "swr";
import type { WorkspaceSuggestion } from "@/types/suggestion";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

export function useSuggestions() {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceSuggestion[]>(
    "/api/suggestions",
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL },
  );

  return {
    suggestions: data ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
