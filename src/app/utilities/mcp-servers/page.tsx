"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { AddMcpServerForm } from "@/components/utilities/mcp-servers/add-mcp-server-form";
import { ServerCard } from "@/components/utilities/mcp-servers/server-card";
import { Card } from "@/components/shared/containers/card";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import { fetcher } from "@/lib/api-client";
import type { McpServerEntry, McpConnectionStatus } from "@/types/claude";

export default function McpServersPage() {
  const { data, error, isLoading, mutate } = useSWR<{
    servers: McpServerEntry[];
  }>("/api/mcp-servers", fetcher);

  const { data: statusData, mutate: mutateStatus } = useSWR<{
    statuses: McpConnectionStatus[];
  }>("/api/mcp-servers/status", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const statusMap = new Map(
    (statusData?.statuses ?? []).map((s) => [s.name, s])
  );

  const handleSaved = useCallback(() => {
    mutate();
    mutateStatus();
  }, [mutate, mutateStatus]);

  return (
    <div>
      <PageHeader
        title="MCP Servers"
        description="MCP servers configured for Claude Code across user, project, and local scopes."
      />

      <AddMcpServerForm onAdded={handleSaved} />

      {isLoading && <StatusText>Loading...</StatusText>}
      {error && (
        <StatusText variant="error">Failed to load MCP servers.</StatusText>
      )}

      {data && data.servers.length === 0 && (
        <Card variant="dashed" className="p-8 text-center">
          <p className="text-muted-foreground">
            No MCP servers configured. Add servers to{" "}
            <code className="text-xs">~/.claude/settings.json</code> or your
            project&apos;s{" "}
            <code className="text-xs">.claude/settings.json</code> to see them
            here.
          </p>
        </Card>
      )}

      {data && data.servers.length > 0 && (
        <div className="grid gap-3">
          {data.servers.map((server, i) => (
            <ServerCard
              key={`${server.scope}-${server.name}-${i}`}
              server={server}
              connectionStatus={statusMap.get(server.name)}
              onSaved={handleSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
