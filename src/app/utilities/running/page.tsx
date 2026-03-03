"use client";

import Link from "next/link";
import { useCallback } from "react";
import useSWR from "swr";
import type { Operation, OperationType } from "@/types/operation";
import type { ChatSessionInfo } from "@/types/chat";
import { OperationSummary, useNow } from "@/components/operation/operation-summary";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const UTILITY_TYPE_PATHS: Partial<Record<OperationType, string>> = {
  "workspace-prune": "/utilities/workspace-prune",
  "mcp-auth": "/utilities/mcp-servers",
  "claude-login": "/utilities/claude-auth",
};

function getViewHref(op: Operation): string | null {
  if (UTILITY_TYPE_PATHS[op.type]) return UTILITY_TYPE_PATHS[op.type]!;
  if (!op.workspace) return null;
  return `/workspace/${encodeURIComponent(op.workspace)}/operations?operationId=${encodeURIComponent(op.id)}`;
}

export default function RunningPage() {
  const { data, error, isLoading, mutate } = useSWR<Operation[]>(
    "/api/operations",
    fetcher,
    { refreshInterval: 3000 }
  );

  const { data: chatSessions } = useSWR<ChatSessionInfo[]>(
    "/api/chat-sessions",
    fetcher,
    { refreshInterval: 3000 }
  );

  const running = data?.filter((op) => op.status === "running") ?? [];
  const activeChats = chatSessions ?? [];
  const now = useNow(running.length > 0 || activeChats.length > 0 ? 1000 : 0);

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

  const nothingRunning = !isLoading && !error && running.length === 0 && activeChats.length === 0;

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

      {nothingRunning && (
        <p className="text-sm text-muted-foreground">
          No running operations.
        </p>
      )}

      {running.length > 0 && (
        <div className="grid gap-3">
          {running.map((op) => (
            <div
              key={op.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <OperationSummary operation={op} now={now} />
              <div className="flex shrink-0 items-center gap-2">
                {getViewHref(op) ? (
                  <Link
                    href={getViewHref(op)!}
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    View
                  </Link>
                ) : (
                  <span className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground">
                    View
                  </span>
                )}
                <button
                  onClick={() => kill(op.id)}
                  className="rounded-md border border-destructive/50 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeChats.length > 0 && (
        <>
          {running.length > 0 && <div className="my-4" />}
          <h2 className="mb-3 text-lg font-semibold">Active Chat Sessions</h2>
          <div className="grid gap-3">
            {activeChats.map((chat) => (
              <div
                key={chat.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">chat</span>
                    <span className="text-sm text-muted-foreground">
                      {chat.workspaceId}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Started {new Date(chat.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/workspace/${encodeURIComponent(chat.workspaceId)}/chat`}
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
