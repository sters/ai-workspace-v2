"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ClaudeVersionPage() {
  const { data, error, isLoading, mutate } = useSWR<{
    version?: string;
    error?: string;
  }>("/api/claude-version", fetcher, { revalidateOnFocus: false });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">Claude Version</h1>
        <button
          onClick={() => mutate()}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        The currently installed Claude Code CLI version.
      </p>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="text-sm text-destructive">
          Failed to fetch Claude version.
        </p>
      )}

      {data && !data.error && (
        <div className="rounded-lg border p-4">
          <code className="text-sm">{data.version}</code>
        </div>
      )}

      {data?.error && (
        <div className="rounded-lg border border-destructive/50 p-4">
          <p className="text-sm text-destructive">{data.error}</p>
        </div>
      )}
    </div>
  );
}
