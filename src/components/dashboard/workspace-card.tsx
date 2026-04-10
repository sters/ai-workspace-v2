import Link from "next/link";
import { Loader2, MessageCircleQuestion } from "lucide-react";
import type { WorkspaceListItem } from "@/types/workspace";
import { cardVariants } from "../shared/containers/card";
import { ProgressBar } from "../shared/feedback/progress-bar";
import { StatusBadge } from "../shared/feedback/status-badge";

function formatShortDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function WorkspaceCard({
  workspace,
  isRunning,
  isAsking,
  children,
}: {
  workspace: WorkspaceListItem;
  isRunning?: boolean;
  isAsking?: boolean;
  children?: React.ReactNode;
}) {
  const { name, title, taskType, ticketId, date, repoCount, overallProgress, totalCompleted, totalItems, lastModified } =
    workspace;

  return (
    <Link
      href={`/workspace/${encodeURIComponent(name)}`}
      className={cardVariants("default", `block transition-colors hover:bg-accent/50${
        isAsking ? " border-orange-400/50" : isRunning ? " border-primary/50" : ""
      }`)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {isAsking ? (
            <MessageCircleQuestion className="h-4 w-4 shrink-0 animate-pulse text-orange-500" />
          ) : isRunning ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : null}
          <h3 className="truncate font-semibold">{title}</h3>
          <span className="shrink-0 text-sm text-muted-foreground">{name}</span>
        </div>
        <StatusBadge label={taskType} />
      </div>

      <div className="mt-2 flex items-center gap-6 text-sm text-muted-foreground">
        {ticketId && <span>Ticket: {ticketId}</span>}
        <span>{repoCount} repos</span>
        <span>Created: {formatShortDate(date)}</span>
        <span>Updated: {formatShortDate(lastModified)}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={overallProgress} showLabel={false} className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">
          {totalCompleted}/{totalItems} items
        </span>
      </div>

      {children}
    </Link>
  );
}
