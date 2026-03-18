"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { Spinner } from "@/components/shared/feedback/spinner";
import { QuickSearchResults, DeepSearchResults } from "./quick-search-results";
import { useOperation } from "@/hooks/use-operation";
import { parseStreamEvent } from "@/lib/parsers/stream";
import type { QuickSearchResponse, DeepSearchResponse, DeepSearchResult, SearchMode } from "@/types/search";

function updateURL(q: string | null, mode: SearchMode) {
  const url = new URL(window.location.href);
  if (q && mode) {
    url.searchParams.set("q", q);
    url.searchParams.set("mode", mode);
  } else {
    url.searchParams.delete("q");
    url.searchParams.delete("mode");
  }
  window.history.replaceState(null, "", url.toString());
}

export function WorkspaceSearch({ onSearchActiveChange }: { onSearchActiveChange?: (active: boolean) => void }) {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const initialMode = (searchParams.get("mode") as SearchMode) || null;

  const [query, setQuery] = useState(initialQ);
  const [activeMode, setActiveMode] = useState<SearchMode>(initialMode);

  // Quick search state
  const [quickData, setQuickData] = useState<QuickSearchResponse | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  // Deep search state
  const { operation, events, isRunning, start, cancel, reset } =
    useOperation("dashboard-search");

  // Auto-run search from URL params on mount
  const initialRunRef = useRef(false);
  useEffect(() => {
    if (initialRunRef.current || !initialQ || !initialMode) return;
    initialRunRef.current = true;
    if (initialMode === "quick") {
      runQuickSearchWith(initialQ);
    }
    // Deep search from URL: don't auto-start (it's expensive), just restore the query
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parse deep search structured results from SSE events
  const deepData = useMemo<DeepSearchResponse | null>(() => {
    if (activeMode !== "deep" || isRunning || events.length === 0) return null;

    for (const event of events) {
      if (event.type === "output") {
        const parsed = parseStreamEvent(event.data);
        for (const entry of parsed) {
          if (entry.kind === "result" && entry.content) {
            try {
              const json = JSON.parse(entry.content);
              if (json.error) return null;
              const results: DeepSearchResult[] = json.results ?? [];
              return { query, results };
            } catch {
              // not JSON, ignore
            }
          }
        }
      }
    }
    return null;
  }, [activeMode, isRunning, events, query]);

  const deepError = useMemo<string | null>(() => {
    if (activeMode !== "deep" || isRunning || events.length === 0) return null;
    if (deepData) return null;
    if (operation?.status === "failed") return "Deep search failed";
    for (const event of events) {
      if (event.type === "output") {
        const parsed = parseStreamEvent(event.data);
        for (const entry of parsed) {
          if (entry.kind === "result" && entry.content) {
            try {
              const json = JSON.parse(entry.content);
              if (json.error) return json.error;
            } catch {
              // ignore
            }
          }
        }
      }
    }
    return null;
  }, [activeMode, isRunning, events, operation?.status, deepData]);

  const runQuickSearchWith = useCallback(async (q: string) => {
    setActiveMode("quick");
    setQuickLoading(true);
    setQuickError(null);
    setQuickData(null);
    updateURL(q, "quick");

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data: QuickSearchResponse = await res.json();
      setQuickData(data);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setQuickLoading(false);
    }
  }, []);

  const runQuickSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    await runQuickSearchWith(q);
  }, [query, runQuickSearchWith]);

  const runDeepSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setActiveMode("deep");
    updateURL(q, "deep");
    await start("search", { query: q });
  }, [query, start]);

  const handleClear = useCallback(() => {
    setQuery("");
    setActiveMode(null);
    setQuickData(null);
    setQuickError(null);
    reset();
    updateURL(null, null);
  }, [reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        runQuickSearch();
      }
    },
    [runQuickSearch],
  );

  const hasResults = activeMode === "quick"
    ? quickData || quickLoading || quickError
    : activeMode === "deep"
      ? operation || isRunning
      : false;

  useEffect(() => {
    onSearchActiveChange?.(!!hasResults);
  }, [hasResults, onSearchActiveChange]);

  return (
    <div className="mb-4 space-y-3">
      <div className="flex gap-2">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder="Search workspaces..."
          className="flex-1"
        />
        <SplitButton
          label="Quick Search"
          onClick={runQuickSearch}
          disabled={!query.trim() || quickLoading || isRunning}
          items={[
            {
              label: "Deep Search",
              onClick: runDeepSearch,
            },
          ]}
        />
        {hasResults && (
          <Button variant="outline" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {activeMode === "quick" && (
        <QuickSearchResults
          data={quickData}
          isLoading={quickLoading}
          error={quickError}
        />
      )}

      {activeMode === "deep" && (
        <>
          {isRunning && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner />
              Deep searching...
              <Button variant="destructive-sm" onClick={cancel} className="ml-auto">
                Cancel
              </Button>
            </div>
          )}
          {!isRunning && (
            <DeepSearchResults
              data={deepData}
              error={deepError}
            />
          )}
        </>
      )}
    </div>
  );
}
