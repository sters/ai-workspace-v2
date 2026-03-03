"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import type { Operation, OperationPhaseInfo, OperationType } from "@/types/operation";
import type { ChatSessionInfo } from "@/types/chat";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const UTILITY_TYPE_PATHS: Partial<Record<OperationType, string>> = {
  "workspace-prune": "/utilities/workspace-prune",
  "mcp-auth": "/utilities/mcp-servers",
  "claude-login": "/utilities/claude-auth",
};

function getViewHref(op: Operation): string | null {
  if (UTILITY_TYPE_PATHS[op.type]) return UTILITY_TYPE_PATHS[op.type]!;
  if (!op.workspace) return null;
  return `/workspace/${encodeURIComponent(op.workspace)}?operationId=${encodeURIComponent(op.id)}`;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function PhaseExpiration({ phase, now }: { phase: OperationPhaseInfo; now: number }) {
  if (!phase.timeoutMs || !phase.startedAt) return null;

  const elapsed = now - new Date(phase.startedAt).getTime();
  const remaining = phase.timeoutMs - elapsed;
  const pct = Math.max(0, Math.min(100, (elapsed / phase.timeoutMs) * 100));
  const isExpired = remaining <= 0;
  const isWarning = !isExpired && remaining < 60_000;

  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Timeout:</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            isExpired
              ? "bg-destructive"
              : isWarning
                ? "bg-yellow-500"
                : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={
          isExpired
            ? "font-medium text-destructive"
            : isWarning
              ? "text-yellow-600"
              : "text-muted-foreground"
        }
      >
        {formatRemaining(remaining)} remaining
      </span>
    </div>
  );
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
                  {currentPhase && <PhaseExpiration phase={currentPhase} now={now} />}
                </div>
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
            );
          })}
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
