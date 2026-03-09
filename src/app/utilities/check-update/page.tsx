"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Card } from "@/components/shared/containers/card";
import { Callout } from "@/components/shared/containers/callout";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import type { UpdateCheckResult } from "@/lib/update";

type CheckUpdateResponse = UpdateCheckResult & {
  devMode?: boolean;
  error?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CheckUpdatePage() {
  const { data, error, isLoading, mutate } = useSWR<CheckUpdateResponse>(
    "/api/check-update",
    fetcher,
    { revalidateOnFocus: false }
  );

  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setUpdateError(null);

    try {
      const res = await fetch("/api/check-update", { method: "POST" });
      const body = await res.json();

      if (!res.ok) {
        setUpdateError(body.error || "Failed to trigger update.");
        setUpdating(false);
        return;
      }

      // Poll until server comes back
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch("/api/check-update", {
            signal: AbortSignal.timeout(3000),
          });
          if (r.ok) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            location.reload();
          }
        } catch {
          // Server still restarting
        }
      }, 2000);
    } catch {
      setUpdateError("Failed to connect to server.");
      setUpdating(false);
    }
  }, []);

  return (
    <div>
      <PageHeader
        title="Check Update"
        description="Check for available updates to ai-workspace-v2."
        onRefresh={() => mutate()}
      />

      {isLoading && <StatusText>Checking...</StatusText>}
      {error && (
        <StatusText variant="error">
          Failed to check for updates.
        </StatusText>
      )}

      {data?.error && (
        <Callout variant="error">
          <StatusText variant="error">{data.error}</StatusText>
        </Callout>
      )}

      {data && !data.error && data.devMode && (
        <Callout variant="info">
          Running in development mode. Updates are managed via git.
        </Callout>
      )}

      {data && !data.error && !data.devMode && (
        <Card>
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Current: </span>
              <code>{data.currentHash.slice(0, 7)}</code>
            </p>
            {data.latestHash && (
              <p>
                <span className="text-muted-foreground">Latest: </span>
                <code>{data.latestHash.slice(0, 7)}</code>
              </p>
            )}
            {data.updateAvailable ? (
              <div className="space-y-3">
                <Callout variant="warning">
                  Update available! Run:{" "}
                  <code className="text-xs">
                    bunx github:sters/ai-workspace-v2 --self-update
                  </code>
                </Callout>
                {updating ? (
                  <Callout variant="info">
                    Updating... The server is restarting. This page will reload
                    automatically.
                  </Callout>
                ) : (
                  <button
                    onClick={handleUpdate}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Update Now
                  </button>
                )}
                {updateError && (
                  <Callout variant="error">{updateError}</Callout>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                You are running the latest version.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
