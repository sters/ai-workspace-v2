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
  type LucideIcon,
} from "lucide-react";
import type { OperationListItem } from "@/types/operation";
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

const CHAT_LABELS: Record<ChatActivity, string> = {
  busy: "Chat working",
  waiting: "Chat waiting for input",
  // Claims only what is known: the session exists. Said of a working session,
  // "waiting for input" would be wrong rather than merely vague.
  unknown: "Chat open",
};

/**
 * One indicator: a link to the thing it reports on, named by the state it
 * shows. The label carries both, since a link whose name is only its
 * destination would drop the state a screen reader came for.
 *
 * `pointer-events-auto` is what lifts it out of the row overlay described in
 * `WorkspaceRow`, and the `title` lives here rather than on the icon because a
 * `title` attribute on an <svg> renders no tooltip.
 */
function Indicator({
  href,
  label,
  icon: Icon,
  className,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  className: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="pointer-events-auto flex shrink-0 items-center rounded-sm hover:bg-background/80"
    >
      <Icon className={cn("h-3.5 w-3.5", className)} />
    </Link>
  );
}

function WorkspaceRow({
  workspace,
  active,
  isRunning,
  operationId,
  isAsking,
  chatActivity,
  archived,
}: {
  workspace: WorkspaceListItem;
  active: boolean;
  isRunning?: boolean;
  /** The operation to open, when the running one is known. */
  operationId?: string;
  isAsking?: boolean;
  chatActivity?: ChatActivity;
  archived?: boolean;
}) {
  const { name, title, overallProgress, totalCompleted, totalItems } =
    workspace;
  const base = `/workspace/${encodeURIComponent(name)}`;
  const operationHref = operationId
    ? `${base}/operations?operationId=${encodeURIComponent(operationId)}`
    : `${base}/operations`;

  return (
    // The row's own link is an overlay rather than a wrapper, so the
    // indicators can be links too: an <a> inside an <a> is invalid and
    // browsers drop the inner one. The content above it is
    // `pointer-events-none` so a click anywhere but an indicator still falls
    // through to the overlay, and the overlay is named by the title because
    // the visible text is no longer inside it.
    <div
      className={cn(
        "relative border-l-2 px-2 py-1.5 transition-colors hover:bg-accent/60",
        active
          ? "border-primary bg-accent"
          : "border-transparent hover:border-border",
        archived && "opacity-60",
      )}
    >
      <Link
        href={base}
        aria-label={title}
        aria-current={active ? "page" : undefined}
        className="absolute inset-0"
      />
      <div className="pointer-events-none relative flex items-center gap-1.5">
        {isAsking ? (
          <Indicator
            href={operationHref}
            label="Waiting for an answer"
            icon={MessageCircleQuestion}
            className="animate-pulse text-orange-500"
          />
        ) : isRunning ? (
          <Indicator
            href={operationHref}
            label="Operation running"
            icon={Loader2}
            className="animate-spin text-primary"
          />
        ) : null}
        {chatActivity && (
          <Indicator
            // `/chat` has no index route, so the tab's own href is the target.
            href={`${base}/chat/interactive`}
            label={CHAT_LABELS[chatActivity]}
            icon={Terminal}
            className={
              chatActivity === "busy"
                ? "animate-pulse text-blue-500"
                : "text-muted-foreground"
            }
          />
        )}
        <span
          className={cn(
            "truncate text-sm",
            active ? "font-semibold" : "font-medium",
          )}
        >
          {title}
        </span>
      </div>
      {name !== title && (
        // The directory the workspace lives in, which is what git branches and
        // paths are named after. Omitted when it *is* the title, since
        // `listWorkspaces` falls back to the directory name for a README with
        // no heading.
        <div className="pointer-events-none relative truncate text-[10px] text-muted-foreground">
          {name}
        </div>
      )}
      <div className="pointer-events-none relative mt-1 flex items-center gap-2">
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
    </div>
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

  // The operation a row's indicator opens, preferring one that is waiting for
  // an answer: with several running, that is the one the user is being asked
  // to go and look at.
  const linkedOperations = new Map<string, OperationListItem>();
  for (const op of operations) {
    const current = linkedOperations.get(op.workspace);
    if (!current || (op.hasPendingAsk && !current.hasPendingAsk)) {
      linkedOperations.set(op.workspace, op);
    }
  }
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
      operationId={linkedOperations.get(ws.name)?.id}
      isAsking={linkedOperations.get(ws.name)?.hasPendingAsk}
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
