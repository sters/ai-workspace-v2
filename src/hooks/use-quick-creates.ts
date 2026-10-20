"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/api";
import type { QuickCreateProgress } from "@/types/workspace";

const POLL_MS = 1000;

/**
 * The server's record of the web form's quick creates. Polled while one runs,
 * or while `polling` says one is about to (the request is in flight but may
 * not have registered yet); read once otherwise.
 */
export function useQuickCreates({ polling }: { polling: boolean }) {
  const { data } = useSWR<QuickCreateProgress[]>("/api/quick-creates", fetcher, {
    refreshInterval: (latest) =>
      polling || latest?.some((q) => q.state === "running") ? POLL_MS : 0,
  });
  return { quickCreates: data ?? [] };
}
