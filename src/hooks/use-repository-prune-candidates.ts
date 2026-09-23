"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { RepositoryPruneCandidate } from "@/types/repository-prune";

interface RepositoryPruneResponse {
  repositories: RepositoryPruneCandidate[];
}

/**
 * The clones under `repositories/` with their usage, least recently referenced
 * first. No refresh interval and no focus revalidation: each read runs a git
 * command per clone, and the answer changes when an operation sets a worktree
 * up — which the Delete button's own refresh covers.
 */
export function useRepositoryPruneCandidates() {
  const { data, error, isLoading, mutate } = useSWR<RepositoryPruneResponse>(
    "/api/repositories/prune",
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    repositories: data?.repositories ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
