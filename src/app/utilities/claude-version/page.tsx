"use client";

import useSWR from "swr";
import { Card } from "@/components/shared/containers/card";
import { FetchStatus } from "@/components/shared/feedback/fetch-status";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { fetcher } from "@/lib/api";

export default function ClaudeVersionPage() {
  const { data, error, isLoading, mutate } = useSWR<{
    version?: string;
    error?: string;
  }>("/api/claude-version", fetcher, { revalidateOnFocus: false });

  return (
    <div>
      <PageHeader
        title="Claude Version"
        description="The currently installed Claude Code CLI version."
        onRefresh={() => mutate()}
      />
      <FetchStatus
        isLoading={isLoading}
        error={error}
        apiError={data?.error}
        errorText="Failed to fetch Claude version."
      />
      {data && !data.error && (
        <Card>
          <code className="text-sm">{data.version}</code>
        </Card>
      )}
    </div>
  );
}
