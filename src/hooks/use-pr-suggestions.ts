"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { PrSuggestions } from "@/lib/pr-watcher/suggestions";

const REFRESH = { refreshInterval: 60_000 };

export function prSuggestionsUrl(workspace: string): string {
  return `/api/workspaces/${encodeURIComponent(workspace)}/pr-suggestions`;
}

/** What the watcher proposes for one workspace's PRs. */
export function usePrSuggestions(workspace: string) {
  const { data, mutate } = useSWR<PrSuggestions>(prSuggestionsUrl(workspace), fetcher, REFRESH);
  const suggestions = Array.isArray(data?.conflicts) ? data : undefined;
  const markHandled = async () => {
    await fetch(prSuggestionsUrl(workspace), { method: "DELETE" });
    void mutate();
  };
  return { suggestions, markHandled };
}

/** Unarchived workspaces that have something proposed on their PRs. */
export function usePrSuggestionWorkspaces(): Set<string> {
  const { data } = useSWR<{ workspaces: string[] }>("/api/pr-suggestions", fetcher, REFRESH);
  return new Set(data?.workspaces ?? []);
}
