import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { WorkspaceSummary } from "@/types/workspace";
import { ProgressBar } from "../shared/progress-bar";
import { StatusBadge } from "../shared/status-badge";

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
}: {
  workspace: WorkspaceSummary;
  isRunning?: boolean;
}) {
  const { name, meta, overallProgress, totalCompleted, totalItems, lastModified } =
    workspace;

  return (
    <Link
      href={`/workspace/${encodeURIComponent(name)}`}
      className={`block rounded-lg border p-4 transition-colors hover:bg-accent/50${
        isRunning ? " border-primary/50" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {isRunning && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          )}
          <h3 className="truncate font-semibold">{meta.title}</h3>
          <span className="shrink-0 text-sm text-muted-foreground">{name}</span>
        </div>
        <StatusBadge label={meta.taskType} />
      </div>

      <div className="mt-2 flex items-center gap-6 text-sm text-muted-foreground">
        {meta.ticketId && <span>Ticket: {meta.ticketId}</span>}
        <span>{meta.repositories.length} repos</span>
        <span>Created: {formatShortDate(meta.date)}</span>
        <span>Updated: {formatShortDate(lastModified)}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={overallProgress} showLabel={false} className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">
          {totalCompleted}/{totalItems} items
        </span>
      </div>
    </Link>
  );
}
