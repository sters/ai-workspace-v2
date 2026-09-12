"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  ChevronDown,
  Loader2,
  MessageCircleQuestion,
  Terminal,
} from "lucide-react";
import type { WorkspaceListItem } from "@/types/workspace";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useChatSessions, type ChatActivity } from "@/hooks/use-chat-sessions";
import { cn } from "@/lib/utils";

/**
 * The workspace name for `/workspace/<name>/...`, or null on any other route.
 * The segment is encoded in the href, so it is decoded before comparison.
 */
function activeWorkspaceName(pathname: string): string | null {
  const segment = pathname.split("/")[2];
  if (!pathname.startsWith("/workspace/") || !segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * The chat half of a row's indicator cluster. Absent when the workspace has no
 * live session, since most do not and a permanent glyph says nothing.
 */
const CHAT_LABELS: Record<ChatActivity, string> = {
  busy: "Chat working",
  waiting: "Chat waiting for input",
  // Claims only what is known: the session exists. Said of a working session,
  // "waiting for input" would be wrong rather than merely vague.
  unknown: "Chat open",
};

function ChatIndicator({ activity }: { activity: ChatActivity }) {
  const busy = activity === "busy";
  const label = CHAT_LABELS[activity];
  return (
    // The tooltip lives on a wrapper: a `title` attribute on an <svg> renders
    // no tooltip, and a terminal glyph in two colours needs the words.
    <span title={label} className="flex shrink-0 items-center">
      <Terminal
        aria-label={label}
        className={cn(
          "h-3.5 w-3.5",
          busy ? "animate-pulse text-blue-500" : "text-muted-foreground",
        )}
      />
    </span>
  );
}

function WorkspaceRow({
  workspace,
  active,
  isRunning,
  isAsking,
  chatActivity,
  archived,
}: {
  workspace: WorkspaceListItem;
  active: boolean;
  isRunning?: boolean;
  isAsking?: boolean;
  chatActivity?: ChatActivity;
  archived?: boolean;
}) {
  const { name, title, overallProgress, totalCompleted, totalItems } =
    workspace;

  return (
    <Link
      href={`/workspace/${encodeURIComponent(name)}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block border-l-2 px-2 py-1.5 transition-colors hover:bg-accent/60",
        active
          ? "border-primary bg-accent"
          : "border-transparent hover:border-border",
        archived && "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5">
        {isAsking ? (
          <MessageCircleQuestion
            aria-label="Waiting for an answer"
            className="h-3.5 w-3.5 shrink-0 animate-pulse text-orange-500"
          />
        ) : isRunning ? (
          <Loader2
            aria-label="Operation running"
            className="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
          />
        ) : null}
        {chatActivity && <ChatIndicator activity={chatActivity} />}
        <span
          className={cn(
            "truncate text-sm",
            active ? "font-semibold" : "font-medium",
          )}
        >
          {title}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full",
              overallProgress === 100 ? "bg-green-500" : "bg-blue-500",
            )}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {totalCompleted}/{totalItems}
        </span>
      </div>
    </Link>
  );
}

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { workspaces, olderCount, archivedCount, isLoading, error } =
    useWorkspaces({
      recentOnly: !showAll && !showArchived,
      includeArchived: showArchived,
    });
  const { runningWorkspaces, operations } = useRunningOperations();
  const { chatActivity } = useChatSessions();

  const askingWorkspaces = new Set(
    operations.filter((op) => op.hasPendingAsk).map((op) => op.workspace),
  );
  const active = activeWorkspaceName(pathname);

  const activeWorkspaces = showArchived
    ? workspaces.filter((ws) => !ws.archived)
    : workspaces;
  const archivedWorkspaces = showArchived
    ? workspaces.filter((ws) => ws.archived)
    : [];

  const renderRow = (ws: WorkspaceListItem, archived?: boolean) => (
    <WorkspaceRow
      key={ws.name}
      workspace={ws}
      active={ws.name === active}
      isRunning={runningWorkspaces.has(ws.name)}
      isAsking={askingWorkspaces.has(ws.name)}
      chatActivity={chatActivity.get(ws.name)}
      archived={archived}
    />
  );

  return (
    <aside className="w-60 shrink-0 border-r bg-card">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="border-b px-3 py-4">
          <Link
            href="/"
            className="text-sm font-semibold hover:text-muted-foreground"
          >
            Workspaces
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto p-1">
          {isLoading ? (
            <div className="space-y-1 p-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : error ? (
            <p className="p-2 text-xs text-destructive">
              Failed to load workspaces.
            </p>
          ) : workspaces.length === 0 &&
            olderCount === 0 &&
            archivedCount === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              No workspaces yet.
            </p>
          ) : (
            <>
              {activeWorkspaces.map((ws) => renderRow(ws))}

              {!showAll && !showArchived && olderCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {olderCount} older
                </button>
              )}

              {!showArchived && archivedCount > 0 && (
                <button
                  onClick={() => setShowArchived(true)}
                  className="flex w-full items-center justify-center gap-1 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {archivedCount} archived
                </button>
              )}

              {showArchived && archivedWorkspaces.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-2 pt-3 pb-1">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      Archived
                    </span>
                    <button
                      onClick={() => setShowArchived(false)}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    >
                      Hide
                    </button>
                  </div>
                  {archivedWorkspaces.map((ws) => renderRow(ws, true))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
