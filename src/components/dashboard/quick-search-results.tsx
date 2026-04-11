"use client";

import type { QuickSearchResponse, QuickSearchResult, DeepSearchResponse } from "@/types/search";
import type { WorkspaceListItem } from "@/types/workspace";
import { Spinner } from "@/components/shared/feedback/spinner";
import { StatusText } from "@/components/shared/feedback/status-text";
import { WorkspaceCard } from "./workspace-card";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useRunningOperations } from "@/hooks/use-running-operations";

function SearchMatchLines({ matches }: { matches: QuickSearchResult["matches"] }) {
  return (
    <div className="mt-2 space-y-0.5 border-t pt-2">
      {matches.slice(0, 5).map((match) => (
        <div
          key={match.lineNumber}
          className="flex gap-2 text-xs font-mono"
        >
          <span className="shrink-0 text-muted-foreground w-6 text-right">
            {match.lineNumber}
          </span>
          <span className="truncate">{match.line}</span>
        </div>
      ))}
      {matches.length > 5 && (
        <div className="text-xs text-muted-foreground">
          ...and {matches.length - 5} more match{matches.length - 5 !== 1 ? "es" : ""}
        </div>
      )}
    </div>
  );
}

function SearchExcerpts({ excerpts }: { excerpts: string[] }) {
  return (
    <div className="mt-2 space-y-0.5 border-t pt-2">
      {excerpts.slice(0, 5).map((excerpt, i) => (
        <div key={i} className="text-xs text-muted-foreground">
          {excerpt}
        </div>
      ))}
      {excerpts.length > 5 && (
        <div className="text-xs text-muted-foreground">
          ...and {excerpts.length - 5} more
        </div>
      )}
    </div>
  );
}

function useWorkspaceMap() {
  const { workspaces } = useWorkspaces({ includeArchived: true });
  const { runningWorkspaces, operations } = useRunningOperations();
  const wsMap = new Map<string, WorkspaceListItem>();
  for (const ws of workspaces) {
    wsMap.set(ws.name, ws);
  }
  const askingWorkspaces = new Set(
    operations.filter((op) => op.hasPendingAsk).map((op) => op.workspace),
  );
  return { wsMap, runningWorkspaces, askingWorkspaces };
}

export function QuickSearchResults({
  data,
  isLoading,
  error,
}: {
  data: QuickSearchResponse | null;
  isLoading: boolean;
  error: string | null;
}) {
  const { wsMap, runningWorkspaces, askingWorkspaces } = useWorkspaceMap();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner />
        Searching...
      </div>
    );
  }

  if (error) {
    return <StatusText variant="error">{error}</StatusText>;
  }

  if (!data) return null;

  if (data.results.length === 0) {
    return (
      <StatusText>
        No results found for &quot;{data.query}&quot;.
      </StatusText>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.totalMatches} match{data.totalMatches !== 1 ? "es" : ""} in{" "}
        {data.results.length} workspace{data.results.length !== 1 ? "s" : ""}
      </p>
      {data.results.map((result) => {
        const ws = wsMap.get(result.workspaceName);
        if (!ws) return null;
        return (
          <WorkspaceCard
            key={result.workspaceName}
            workspace={ws}
            isRunning={runningWorkspaces.has(result.workspaceName)}
            isAsking={askingWorkspaces.has(result.workspaceName)}
            archived={ws.archived}
          >
            <SearchMatchLines matches={result.matches} />
          </WorkspaceCard>
        );
      })}
    </div>
  );
}

export function DeepSearchResults({
  data,
  error,
}: {
  data: DeepSearchResponse | null;
  error: string | null;
}) {
  const { wsMap, runningWorkspaces, askingWorkspaces } = useWorkspaceMap();

  if (error) {
    return <StatusText variant="error">{error}</StatusText>;
  }

  if (!data) return null;

  if (data.results.length === 0) {
    return (
      <StatusText>
        No results found for &quot;{data.query}&quot;.
      </StatusText>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.results.length} workspace{data.results.length !== 1 ? "s" : ""} found
      </p>
      {data.results.map((result) => {
        const ws = wsMap.get(result.workspaceName);
        if (!ws) return null;
        return (
          <WorkspaceCard
            key={result.workspaceName}
            workspace={ws}
            isRunning={runningWorkspaces.has(result.workspaceName)}
            isAsking={askingWorkspaces.has(result.workspaceName)}
            archived={ws.archived}
          >
            <SearchExcerpts excerpts={result.excerpts} />
          </WorkspaceCard>
        );
      })}
    </div>
  );
}
