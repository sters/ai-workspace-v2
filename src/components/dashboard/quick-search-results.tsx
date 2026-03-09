"use client";

import Link from "next/link";
import type { QuickSearchResponse, DeepSearchResponse } from "@/types/search";
import { Spinner } from "@/components/shared/feedback/spinner";
import { StatusText } from "@/components/shared/feedback/status-text";

export function QuickSearchResults({
  data,
  isLoading,
  error,
}: {
  data: QuickSearchResponse | null;
  isLoading: boolean;
  error: string | null;
}) {
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
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {data.totalMatches} match{data.totalMatches !== 1 ? "es" : ""} in{" "}
        {data.results.length} workspace{data.results.length !== 1 ? "s" : ""}
      </p>
      {data.results.map((result) => (
        <Link
          key={result.workspaceName}
          href={`/workspace/${result.workspaceName}`}
          className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
        >
          <div className="font-medium text-sm">{result.title}</div>
          <div className="text-xs text-muted-foreground">{result.workspaceName}</div>
          <div className="mt-1.5 space-y-0.5">
            {result.matches.slice(0, 5).map((match) => (
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
            {result.matches.length > 5 && (
              <div className="text-xs text-muted-foreground">
                ...and {result.matches.length - 5} more match{result.matches.length - 5 !== 1 ? "es" : ""}
              </div>
            )}
          </div>
        </Link>
      ))}
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
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {data.results.length} workspace{data.results.length !== 1 ? "s" : ""} found
      </p>
      {data.results.map((result) => (
        <Link
          key={result.workspaceName}
          href={`/workspace/${result.workspaceName}`}
          className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
        >
          <div className="font-medium text-sm">{result.title}</div>
          <div className="text-xs text-muted-foreground">{result.workspaceName}</div>
          <div className="mt-1.5 space-y-0.5">
            {result.excerpts.slice(0, 5).map((excerpt, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                {excerpt}
              </div>
            ))}
            {result.excerpts.length > 5 && (
              <div className="text-xs text-muted-foreground">
                ...and {result.excerpts.length - 5} more
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
