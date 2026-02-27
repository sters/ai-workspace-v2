"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useOperation } from "@/hooks/use-operation";
import { McpAuthTerminal } from "@/components/operation/mcp-auth-terminal";
import type { McpServerEntry, McpConnectionStatus } from "@/types/claude";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ConnectionBadge({
  connectionStatus,
}: {
  connectionStatus?: McpConnectionStatus;
}) {
  if (!connectionStatus) return null;

  const { status, statusText } = connectionStatus;
  if (status === "ok") {
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
        Connected
      </span>
    );
  }
  if (status === "needs_auth") {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
        Needs auth
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
        title={statusText}
      >
        Error
      </span>
    );
  }
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
      {statusText}
    </span>
  );
}

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
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">MCP Servers</h1>
        <button
          onClick={() => mutateStatus()}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
        >
          Check Status
        </button>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        MCP servers configured for Claude Code across user, project, and local
        scopes.
      </p>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      {error && (
        <p className="text-sm text-destructive">
          Failed to load MCP servers.
        </p>
      )}

      {data && data.servers.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No MCP servers configured. Add servers to{" "}
            <code className="text-xs">~/.claude/settings.json</code> or your
            project&apos;s{" "}
            <code className="text-xs">.claude/settings.json</code> to see them
            here.
          </p>
        </div>
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

function ServerCard({
  server,
  connectionStatus,
  onSaved,
}: {
  server: McpServerEntry;
  connectionStatus?: McpConnectionStatus;
  onSaved: () => void;
}) {
  const needsAuth = connectionStatus?.status === "needs_auth";

  // MCP auth operation — single click login
  const mcpAuth = useOperation(`mcp-auth:${server.name}`);
  const authStartedRef = useRef(false);

  const handleLogin = useCallback(async () => {
    if (authStartedRef.current || mcpAuth.isRunning) return;
    authStartedRef.current = true;
    try {
      const body: Record<string, string> = { serverName: server.name };
      if (!needsAuth) {
        body.forceReauth = "true";
      }
      await mcpAuth.start("mcp-auth", body);
    } catch (err) {
      console.error("MCP auth failed to start:", err);
    }
  }, [mcpAuth, server.name, needsAuth]);

  // Reset the started ref when operation finishes
  useEffect(() => {
    if (!mcpAuth.isRunning && !mcpAuth.operation) {
      authStartedRef.current = false;
    }
  }, [mcpAuth.isRunning, mcpAuth.operation]);

  // Refresh status when auth operation completes
  useEffect(() => {
    if (mcpAuth.operation && !mcpAuth.isRunning) {
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpAuth.isRunning]);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{server.name}</h2>
        <ConnectionBadge connectionStatus={connectionStatus} />
        <div className="ml-auto flex items-center gap-2">
          {!mcpAuth.isRunning && !mcpAuth.operation && (
            <button
              onClick={handleLogin}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                needsAuth
                  ? "border-blue-300 text-blue-700 hover:bg-blue-50"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {needsAuth ? "Login" : "Reauth"}
            </button>
          )}
          {mcpAuth.isRunning && (
            <button
              onClick={mcpAuth.cancel}
              className="rounded-md border border-red-300 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Cancel
            </button>
          )}
          {mcpAuth.operation && !mcpAuth.isRunning && (
            <button
              onClick={mcpAuth.reset}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        {server.config.command != null && (
          <p>
            <span className="font-medium text-foreground">command:</span>{" "}
            <code className="text-xs">
              {String(server.config.command)}
              {Array.isArray(server.config.args) &&
                server.config.args.length > 0 &&
                ` ${(server.config.args as string[]).join(" ")}`}
            </code>
          </p>
        )}
        {server.config.url != null && (
          <p>
            <span className="font-medium text-foreground">url:</span>{" "}
            <code className="text-xs">
              {String(server.config.url)}
            </code>
          </p>
        )}
      </div>

      {/* MCP Auth terminal — inline xterm.js readonly display */}
      {mcpAuth.operation && mcpAuth.events.length > 0 && (
        <div className="mt-3">
          <McpAuthTerminal
            events={mcpAuth.events}
            isRunning={mcpAuth.isRunning}
            operationStatus={mcpAuth.operation.status}
          />
        </div>
      )}
    </div>
  );
}
