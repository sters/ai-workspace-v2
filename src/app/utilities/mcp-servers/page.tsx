"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useOperation } from "@/hooks/use-operation";
import { McpAuthTerminal } from "@/components/operation/mcp-auth-terminal";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { PageHeader } from "@/components/shared/feedback/page-header";
import { StatusText } from "@/components/shared/feedback/status-text";
import type { McpServerEntry, McpConnectionStatus } from "@/types/claude";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ScopeBadge({ scope }: { scope: McpServerEntry["scope"] }) {
  const styles = {
    user: "bg-purple-100 text-purple-700",
    project: "bg-blue-100 text-blue-700",
    local: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${styles[scope]}`}
    >
      {scope}
    </span>
  );
}

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

function AddMcpServerForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState("sse");
  const [scope, setScope] = useState("project");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/mcp-servers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          transport,
          scope,
          url: url.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ type: "error", message: data.error || "Failed to add" });
      } else {
        setResult({
          type: "success",
          message: data.output || `Added ${name.trim()}`,
        });
        setName("");
        setUrl("");
        onAdded();
      }
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // TODO: Support env and headers options for MCP server configuration

  return (
    <Card className="mb-4">
      <h2 className="mb-3 text-sm font-semibold">Add MCP Server</h2>
      <div className="flex items-end gap-2">
        <div className="flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Scope
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="project">project</option>
            <option value="local">local</option>
          </select>
        </div>
        <div className="flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Transport
          </label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </div>
        <div className="w-40 flex-shrink-0">
          <label className="mb-1 block text-xs text-muted-foreground">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="server-name"
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
          />
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">
            URL / Command
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/sse"
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) handleSubmit();
            }}
          />
        </div>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !url.trim()}
          className="h-8 flex-shrink-0"
        >
          {submitting ? "Adding..." : "Add"}
        </Button>
      </div>
      {result && (
        <p
          className={`mt-2 text-xs ${result.type === "error" ? "text-red-600" : "text-emerald-600"}`}
        >
          {result.message}
        </p>
      )}
    </Card>
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleRemove = useCallback(async () => {
    const res = await fetch("/api/mcp-servers/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: server.name, scope: server.scope }),
    });
    setConfirmingDelete(false);
    if (res.ok) onSaved();
  }, [server.name, server.scope, onSaved]);

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
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{server.name}</h2>
        <ScopeBadge scope={server.scope} />
        <ConnectionBadge connectionStatus={connectionStatus} />
        <div className="ml-auto flex items-center gap-2">
          {!mcpAuth.isRunning && !mcpAuth.operation && (
            <>
              <Button
                variant="outline"
                onClick={handleLogin}
                className={`py-0.5 ${
                  needsAuth
                    ? "border-blue-300 text-blue-700 hover:bg-blue-50"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {needsAuth ? "Login" : "Reauth"}
              </Button>
              {server.scope !== "user" && !confirmingDelete && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDelete(true)}
                  className="py-0.5 border-red-300 text-red-600 hover:bg-red-50"
                >
                  Delete
                </Button>
              )}
              {confirmingDelete && (
                <>
                  <span className="text-xs text-red-600">Delete?</span>
                  <Button
                    variant="outline"
                    onClick={handleRemove}
                    className="py-0.5 border-red-300 text-red-600 hover:bg-red-50"
                  >
                    Yes
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingDelete(false)}
                    className="py-0.5"
                  >
                    No
                  </Button>
                </>
              )}
            </>
          )}
          {mcpAuth.isRunning && (
            <Button variant="destructive-sm" onClick={mcpAuth.cancel}>
              Cancel
            </Button>
          )}
          {mcpAuth.operation && !mcpAuth.isRunning && (
            <Button variant="ghost" onClick={mcpAuth.reset}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 text-sm text-muted-foreground">
        {"command" in server.config && server.config.command != null && (
          <code className="text-xs">
            {String(server.config.command)}
            {"args" in server.config &&
              Array.isArray(server.config.args) &&
              server.config.args.length > 0 &&
              ` ${server.config.args.join(" ")}`}
          </code>
        )}
        {"url" in server.config && server.config.url != null && (
          <span className="text-xs text-gray-500">
            {String(server.config.url)}
          </span>
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
    </Card>
  );
}
