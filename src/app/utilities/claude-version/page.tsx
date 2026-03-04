"use client";

import useSWR from "swr";
import { Card } from "@/components/shared/containers/card";
import { Callout } from "@/components/shared/containers/callout";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">
          Failed to fetch Claude version.
        </StatusText>
      )}

      {data && !data.error && (
        <Card>
          <code className="text-sm">{data.version}</code>
        </Card>
      )}

      {data?.error && (
        <Callout variant="error">
          <StatusText variant="error">{data.error}</StatusText>
        </Callout>
      )}
    </div>
  );
}
