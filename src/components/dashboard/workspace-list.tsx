"use client";

import { useState } from "react";
import { Archive, ChevronDown } from "lucide-react";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { usePrSuggestionWorkspaces } from "@/hooks/use-pr-suggestions";
import { WorkspaceCard } from "./workspace-card";
import { StatusText } from "../shared/feedback/status-text";
import { showToast } from "../shared/feedback/toast";
import { useArchiveToggle } from "@/hooks/use-archive-toggle";
import { ArchiveOpenPrsConfirm } from "../workspace/archive-open-prs-confirm";

function reportArchiveError(err: unknown) {
  showToast(err instanceof Error ? err.message : "Failed to archive workspace", "error");
}

export function WorkspaceList() {
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { workspaces, olderCount, archivedCount, isLoading, error, refresh } =
    useWorkspaces({
      recentOnly: !showAll && !showArchived,
      includeArchived: showArchived,
    });
  const { runningWorkspaces, operations } = useRunningOperations();
  const suggestionWorkspaces = usePrSuggestionWorkspaces();

  const askingWorkspaces = new Set(
    operations.filter((op) => op.hasPendingAsk).map((op) => op.workspace),
  );

  const archive = useArchiveToggle(() => void refresh());
  const handleArchiveToggle = (name: string) => archive.toggle(name).catch(reportArchiveError);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <StatusText variant="error">Failed to load workspaces.</StatusText>
    );
  }

  if (workspaces.length === 0 && olderCount === 0 && archivedCount === 0) {
    return (
      <StatusText>
        No workspaces found. Use the Init operation to create one.
      </StatusText>
    );
  }

  const activeWorkspaces = showArchived
    ? workspaces.filter((ws) => !ws.archived)
    : workspaces;
  const archivedWorkspaces = showArchived
    ? workspaces.filter((ws) => ws.archived)
    : [];

  return (
    <div className="space-y-3">
      {archive.openPrs && (
        <ArchiveOpenPrsConfirm
          prs={archive.openPrs}
          onConfirm={() => archive.confirmClose().catch(reportArchiveError)}
          onCancel={archive.cancel}
        />
      )}
      {activeWorkspaces.map((ws) => (
        <WorkspaceCard
          key={ws.name}
          workspace={ws}
          isRunning={runningWorkspaces.has(ws.name)}
          isAsking={askingWorkspaces.has(ws.name)}
          hasSuggestions={suggestionWorkspaces.has(ws.name)}
          onArchive={() => handleArchiveToggle(ws.name)}
        />
      ))}

      {!showAll && !showArchived && olderCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
        >
          <ChevronDown className="h-4 w-4" />
          Show more workspaces ({olderCount})
        </button>
      )}

      {!showArchived && archivedCount > 0 && (
        <button
          onClick={() => setShowArchived(true)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
        >
          <Archive className="h-4 w-4" />
          Show archived workspaces ({archivedCount})
        </button>
      )}

      {showArchived && archivedWorkspaces.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Archived ({archivedWorkspaces.length})
            </span>
            <button
              onClick={() => setShowArchived(false)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Hide
            </button>
          </div>
          {archivedWorkspaces.map((ws) => (
            <WorkspaceCard
              key={ws.name}
              workspace={ws}
              isRunning={runningWorkspaces.has(ws.name)}
              isAsking={askingWorkspaces.has(ws.name)}
              onArchive={() => handleArchiveToggle(ws.name)}
              archived
            />
          ))}
        </>
      )}
    </div>
  );
}
