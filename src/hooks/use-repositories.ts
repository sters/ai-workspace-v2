"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { SelectableRepository } from "@/types/workspace";

interface RepositoriesResponse {
  repositories: SelectableRepository[];
}

/**
 * The cloned repositories under `repositories/`. No refresh interval: the list
 * changes when a clone lands, and each read runs a couple of git commands per
 * repository.
 */
export function useRepositories() {
  const { data, error, isLoading, mutate } = useSWR<RepositoriesResponse>(
    "/api/repositories",
    fetcher,
  );

  return {
    repositories: data?.repositories ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
