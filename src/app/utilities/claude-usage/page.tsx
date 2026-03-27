"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { FetchStatus } from "@/components/shared/feedback/fetch-status";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { useTerminal } from "@/hooks/use-terminal";

export default function ClaudeUsagePage() {
  const { containerRef, termRef, init } = useTerminal({ readonly: true });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [apiError, setApiError] = useState<string | undefined>();
  const [hasData, setHasData] = useState(false);
  const hasFetched = useRef(false);

  const fetchUsage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setApiError(undefined);
    setHasData(false);

    try {
      await init();

      // Read cols/rows from the initialized xterm instance
      const term = termRef.current;
      const cols = term?.cols ?? 120;
      const rows = term?.rows ?? 40;

      const res = await fetch(`/api/claude-usage?cols=${cols}&rows=${rows}`);
      const data = await res.json();

      if (data.error) {
        setApiError(data.error);
        return;
      }

      if (termRef.current && data.usage) {
        termRef.current.write(data.usage);
        setHasData(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [init, termRef]);

  // Auto-fetch on mount
  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      fetchUsage();
    }
  }, [fetchUsage]);

  const handleRefresh = useCallback(() => {
    hasFetched.current = false;
    fetchUsage();
  }, [fetchUsage]);

  return (
    <div>
      <PageHeader
        title="Claude Usage"
        description="Current billing period usage from Claude Code CLI. Runs /usage inside an interactive session."
        onRefresh={handleRefresh}
      />
      <FetchStatus
        isLoading={isLoading}
        error={error}
        apiError={apiError}
        errorText="Failed to fetch Claude usage."
        loadingText="Starting Claude CLI and fetching usage data..."
      />
      <style>{`.claude-usage-term, .claude-usage-term * { cursor: default !important; }`}</style>
      <div
        ref={containerRef}
        className="claude-usage-term min-h-[300px] rounded-lg bg-[#1a1b26] p-1"
        style={{ display: hasData ? undefined : "none" }}
      />
    </div>
  );
}
