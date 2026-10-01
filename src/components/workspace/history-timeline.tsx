"use client";

import { useState, useCallback, useEffect } from "react";
import type { HistoryEntry } from "@/types/workspace";
import { useHistory } from "@/hooks/use-workspace";
import { Button } from "@/components/shared/buttons/button";
import { UnifiedDiffViewer } from "@/components/shared/content/unified-diff-viewer";
import { StatusText } from "@/components/shared/feedback/status-text";
import { parseDiffByFile, type FileDiffEntry } from "@/lib/unified-diff";

function CommitDiff({
  workspaceName,
  hash,
}: {
  workspaceName: string;
  hash: string;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceName)}/history/${encodeURIComponent(hash)}`,
      { signal: controller.signal }
    )
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data) => {
        setDiff(data.diff);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceName, hash]);

  if (loading) {
    return <StatusText className="py-2 text-xs">Loading diff...</StatusText>;
  }

  if (error || diff === null) {
    return <StatusText variant="error" className="py-2 text-xs">Failed to load diff.</StatusText>;
  }

  if (diff.trim() === "") {
    return <StatusText className="py-2 text-xs">No changes in this commit.</StatusText>;
  }

  const files = parseDiffByFile(diff);
  return <FileDiffList files={files} />;
}

function FileDiffList({ files }: { files: FileDiffEntry[] }) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = useCallback((filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(files.map((f) => f.filename)));
  }, [files]);

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>{files.length} file{files.length !== 1 ? "s" : ""} changed</span>
        <span className="text-green-500">
          +{files.reduce((s, f) => s + f.additions, 0)}
        </span>
        <span className="text-red-500">
          -{files.reduce((s, f) => s + f.deletions, 0)}
        </span>
        <span className="ml-auto flex gap-1">
          <button
            type="button"
            className="hover:text-foreground transition-colors"
            onClick={expandAll}
          >
            Expand all
          </button>
          <span>/</span>
          <button
            type="button"
            className="hover:text-foreground transition-colors"
            onClick={collapseAll}
          >
            Collapse all
          </button>
        </span>
      </div>
      {files.map((file) => {
        const expanded = expandedFiles.has(file.filename);
        return (
          <div key={file.filename} className="rounded border border-border overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => toggleFile(file.filename)}
            >
              <span className="shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>
              <span className="font-mono truncate flex-1">{file.filename}</span>
              <span className="shrink-0 text-green-500">+{file.additions}</span>
              <span className="shrink-0 text-red-500">-{file.deletions}</span>
            </button>
            {expanded && <UnifiedDiffViewer content={file.content} />}
          </div>
        );
      })}
    </div>
  );
}

export function HistoryTimeline({ workspaceName }: { workspaceName: string }) {
  const { history, hasMore, isLoading, loadMore } = useHistory(workspaceName);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const toggleDiff = useCallback((hash: string) => {
    setExpandedHash((prev) => (prev === hash ? null : hash));
  }, []);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    await loadMore();
    setLoadingMore(false);
  }, [loadMore]);

  if (isLoading) {
    return <StatusText>Loading...</StatusText>;
  }

  if (history.length === 0) {
    return <StatusText>No history found.</StatusText>;
  }

  return (
    <div className="space-y-0">
      {history.map((entry: HistoryEntry) => (
        <div key={entry.hash} className="border-l-2 border-border py-2 pl-4">
          <Button
            variant="ghost-toggle"
            type="button"
            className="flex w-full cursor-pointer gap-3 text-left hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
            onClick={() => toggleDiff(entry.hash)}
          >
            <div className="flex-1">
              <p className="text-sm">{entry.message}</p>
              <p className="text-xs text-muted-foreground">
                {entry.hash.slice(0, 7)} &middot;{" "}
                {new Date(entry.date).toLocaleString()}
              </p>
            </div>
            <span className="text-xs self-center">
              {expandedHash === entry.hash ? "\u25B2" : "\u25BC"}
            </span>
          </Button>
          {expandedHash === entry.hash && (
            <CommitDiff workspaceName={workspaceName} hash={entry.hash} />
          )}
        </div>
      ))}
      {hasMore && (
        <div className="pt-2 pl-4">
          <Button
            variant="ghost"
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
