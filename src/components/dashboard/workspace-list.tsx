"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { WorkspaceCard } from "./workspace-card";
import { StatusText } from "../shared/feedback/status-text";

export function WorkspaceList() {
  const [showAll, setShowAll] = useState(false);
  const { workspaces, olderCount, isLoading, error } = useWorkspaces({
    recentOnly: !showAll,
  });
  const { runningWorkspaces, operations } = useRunningOperations();

  // Build set of workspaces that have a pending ask
  const askingWorkspaces = new Set(
    operations.filter((op) => op.hasPendingAsk).map((op) => op.workspace),
  );

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

  if (workspaces.length === 0 && olderCount === 0) {
    return (
      <StatusText>
        No workspaces found. Use the Init operation to create one.
      </StatusText>
    );
  }

  return (
    <div className="space-y-3">
      {workspaces.map((ws) => (
        <WorkspaceCard
          key={ws.name}
          workspace={ws}
          isRunning={runningWorkspaces.has(ws.name)}
          isAsking={askingWorkspaces.has(ws.name)}
        />
      ))}

      {!showAll && olderCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
        >
          <ChevronDown className="h-4 w-4" />
          Show older workspaces ({olderCount})
        </button>
      )}
    </div>
  );
}
