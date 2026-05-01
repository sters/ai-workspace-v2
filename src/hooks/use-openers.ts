"use client";

import useSWR from "swr";
import type { Opener } from "@/types/config";
import { showToast } from "@/components/shared/feedback/toast";

interface ConfigResponse {
  openers: Opener[];
}

/** Fetch /api/config and extract the server's error body on failure. */
async function fetchOpeners(url: string): Promise<ConfigResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to load openers (HTTP ${res.status})`);
  }
  return (await res.json()) as ConfigResponse;
}

/**
 * Fetch the user-configured `openers` list (editor / terminal / etc.) used to
 * populate the workspace "Open in..." dropdown.
 *
 * Cached by SWR with no auto-refresh — config changes require a server restart
 * anyway so polling has no value. On failure (e.g. invalid `openers` config),
 * surfaces the server's error message via a toast.
 */
export function useOpeners() {
  const { data, error, isLoading } = useSWR<ConfigResponse, Error>(
    "/api/config",
    fetchOpeners,
    {
      onError: (err) => showToast(err.message, "error"),
      shouldRetryOnError: false,
    },
  );
  return {
    openers: data?.openers ?? [],
    isLoading,
    error,
  };
}
