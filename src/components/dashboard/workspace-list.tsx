"use client";

import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { WorkspaceCard } from "./workspace-card";
import { StatusText } from "../shared/feedback/status-text";

export function WorkspaceList() {
  const { workspaces, isLoading, error } = useWorkspaces();
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

  if (workspaces.length === 0) {
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
    </div>
  );
}
