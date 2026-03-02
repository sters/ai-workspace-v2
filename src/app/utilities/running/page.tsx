"use client";

import Link from "next/link";
import { useCallback } from "react";
import useSWR from "swr";
import type { Operation } from "@/types/operation";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function RunningPage() {
  const { data, error, isLoading, mutate } = useSWR<Operation[]>(
    "/api/operations",
    fetcher,
    { refreshInterval: 3000 }
  );

  const running = data?.filter((op) => op.status === "running") ?? [];

  const kill = useCallback(
    async (operationId: string) => {
      await fetch("/api/operations/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      mutate();
    },
    [mutate]
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Running Operations</h1>
        <button
          onClick={() => mutate()}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        All currently running operations across workspaces.
      </p>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="text-sm text-destructive">
          Failed to fetch operations.
        </p>
      )}

      {!isLoading && !error && running.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No running operations.
        </p>
      )}

      {running.length > 0 && (
        <div className="grid gap-3">
          {running.map((op) => {
            const currentPhase = op.phases?.find(
              (p) => p.status === "running"
            );
            return (
              <div
                key={op.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{op.type}</span>
                    <span className="text-sm text-muted-foreground">
                      {op.workspace}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Started {new Date(op.startedAt).toLocaleString()}
                    {currentPhase && (
                      <span className="ml-2">
                        — Phase: {currentPhase.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/workspace/${encodeURIComponent(op.workspace)}/operations`}
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => kill(op.id)}
                    className="rounded-md border border-destructive/50 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
