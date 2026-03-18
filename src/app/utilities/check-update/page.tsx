"use client";

import useSWR from "swr";
import { Card } from "@/components/shared/containers/card";
import { Callout } from "@/components/shared/containers/callout";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher } from "@/lib/api-client";
import type { UpdateCheckResult } from "@/lib/update";

type CheckUpdateResponse = UpdateCheckResult & {
  devMode?: boolean;
  error?: string;
};

export default function CheckUpdatePage() {
  const { data, error, isLoading, mutate } = useSWR<CheckUpdateResponse>(
    "/api/check-update",
    fetcher,
    { revalidateOnFocus: false }
  );

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
              <Callout variant="warning">
                Update available! Run:{" "}
                <code className="text-xs">
                  bunx github:sters/ai-workspace-v2 --self-update
                </code>
              </Callout>
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
