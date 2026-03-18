"use client";

import Link from "next/link";
import { useCallback } from "react";
import useSWR from "swr";
import type { OperationListItem, OperationType } from "@/types/operation";
import type { ChatSessionInfo } from "@/types/chat";
import { OperationSummary, useNow } from "@/components/operation/operation-summary";
import { Button, buttonVariants } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher, killOperation } from "@/lib/api-client";

const UTILITY_TYPE_PATHS: Partial<Record<OperationType, string>> = {
  "workspace-prune": "/utilities/workspace-prune",
  "operation-prune": "/utilities/operation-prune",
  "mcp-auth": "/utilities/mcp-servers",
  "claude-login": "/utilities/claude-auth",
};

function getViewHref(op: OperationListItem): string | null {
  if (UTILITY_TYPE_PATHS[op.type]) return UTILITY_TYPE_PATHS[op.type]!;
  if (!op.workspace) return null;
  return `/workspace/${encodeURIComponent(op.workspace)}/operations?operationId=${encodeURIComponent(op.id)}`;
}

export default function RunningPage() {
  const { data, error, isLoading, mutate } = useSWR<OperationListItem[]>(
    "/api/operations?status=running",
    fetcher,
    { refreshInterval: 10000 }
  );

  const { data: chatSessions, mutate: mutateChatSessions } = useSWR<ChatSessionInfo[]>(
    "/api/chat-sessions",
    fetcher,
    { refreshInterval: 10000 }
  );

  const running = data ?? [];
  const activeChats = chatSessions ?? [];
  const now = useNow(running.length > 0 || activeChats.length > 0 ? 1000 : 0);
  const kill = useCallback(
    async (operationId: string) => {
      await killOperation(operationId);
      mutate();
    },
    [mutate]
  );

  const killChat = useCallback(
    async (sessionId: string) => {
      await fetch("/api/chat-sessions/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      mutateChatSessions();
    },
    [mutateChatSessions]
  );

  const nothingRunning = !isLoading && !error && running.length === 0 && activeChats.length === 0;

  return (
    <div>
      <PageHeader
        title="Running Operations"
        description="All currently running operations across workspaces."
        onRefresh={() => mutate()}
      />

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">Failed to fetch operations.</StatusText>
      )}

      {nothingRunning && <StatusText>No running operations.</StatusText>}

      {running.length > 0 && (
        <div className="grid gap-3">
          {running.map((op) => (
            <Card
              key={op.id}
              className="flex items-center justify-between"
            >
              <OperationSummary operation={op} now={now} />
              <div className="flex shrink-0 items-center gap-2">
                {getViewHref(op) ? (
                  <Link
                    href={getViewHref(op)!}
                    className={buttonVariants("outline-muted")}
                  >
                    View
                  </Link>
                ) : (
                  <span className={buttonVariants("outline-muted", "text-muted-foreground cursor-default hover:bg-transparent")}>
                    View
                  </span>
                )}
                <Button variant="destructive-sm" onClick={() => kill(op.id)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeChats.length > 0 && (
        <>
          {running.length > 0 && <div className="my-4" />}
          <h2 className="mb-3 text-lg font-semibold">Active Chat Sessions</h2>
          <div className="grid gap-3">
            {activeChats.map((chat) => (
              <Card
                key={chat.id}
                className="flex items-center justify-between"
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
                    className={buttonVariants("outline-muted")}
                  >
                    View
                  </Link>
                  <Button variant="destructive-sm" onClick={() => killChat(chat.id)}>
                    Stop
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
