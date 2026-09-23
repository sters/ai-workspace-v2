"use client";

import useSWR from "swr";
import type { UsageLimitStop } from "@/types/operation";
import { SWR_REFRESH_INTERVAL } from "@/lib/constants";
import { fetcher } from "@/lib/api";

/**
 * Workspaces whose latest operation was stopped by a Claude usage limit, keyed
 * by workspace name.
 *
 * Polled at the workspace cadence rather than the running-operations one: the
 * state changes only when a run ends or a new one starts, and it persists until
 * something else runs there.
 */
export function useUsageLimitStops() {
  const { data, mutate } = useSWR<UsageLimitStop[]>(
    "/api/operations/usage-limit",
    fetcher,
    { refreshInterval: SWR_REFRESH_INTERVAL },
  );

  const usageLimitStops = new Map<string, UsageLimitStop>();
  for (const stop of data ?? []) usageLimitStops.set(stop.workspace, stop);

  return { usageLimitStops, mutate };
}
