"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useOperation } from "@/hooks/use-operation";
import { OperationLog } from "@/components/shared/operation-log";

type AuthStatus = {
  hasAuth: boolean;
  authType: "env" | "headers" | "none";
  keyCount: number;
};

type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: Record<string, unknown>;
  authStatus: AuthStatus;
};

type McpConnectionStatus = {
  name: string;
  status: "ok" | "needs_auth" | "error" | "unknown";
  statusText: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const scopeColors: Record<string, string> = {
  user: "bg-blue-100 text-blue-800",
  project: "bg-green-100 text-green-800",
  local: "bg-yellow-100 text-yellow-800",
};

function getServerType(config: Record<string, unknown>): string {
  if (config.type === "sse") return "sse";
  if (config.type === "http") return "http";
  return "stdio";
}

function AuthBadge({ authStatus }: { authStatus: AuthStatus }) {
  if (authStatus.hasAuth) {
    const label =
      authStatus.authType === "env"
        ? `${authStatus.keyCount} env key${authStatus.keyCount !== 1 ? "s" : ""}`
        : `${authStatus.keyCount} header${authStatus.keyCount !== 1 ? "s" : ""}`;
    return (
      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">
      not configured
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

function KeyValueEditor({
  pairs,
  onChange,
  keyLabel,
}: {
  pairs: [string, string][];
  onChange: (pairs: [string, string][]) => void;
  keyLabel: string;
}) {
  const addRow = () => onChange([...pairs, ["", ""]]);
  const removeRow = (idx: number) =>
    onChange(pairs.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: 0 | 1, value: string) => {
    const next = pairs.map((p, i) =>
      i === idx
        ? ([field === 0 ? value : p[0], field === 1 ? value : p[1]] as [
            string,
            string,
          ])
        : p
    );
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {pairs.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={k}
            onChange={(e) => updateRow(i, 0, e.target.value)}
            placeholder={keyLabel}
            className="w-40 rounded-md border bg-background px-2 py-1 text-sm placeholder:text-muted-foreground"
          />
          <input
            type="password"
            value={v}
            onChange={(e) => updateRow(i, 1, e.target.value)}
            placeholder="Value"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm placeholder:text-muted-foreground"
          />
          <button
            onClick={() => removeRow(i)}
            className="rounded px-2 py-1 text-sm text-destructive hover:bg-destructive/10"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        + Add {keyLabel.toLowerCase()}
      </button>
    </div>
  );
}

function AuthConfigForm({
  server,
  onSaved,
}: {
  server: McpServerEntry;
  onSaved: () => void;
}) {
  const type = getServerType(server.config);
  const isStdio = type === "stdio";
  const fieldKey = isStdio ? "env" : "headers";
  const keyLabel = isStdio ? "Variable" : "Header";

  const existing = (server.config[fieldKey] as Record<string, string>) ?? {};
  const [pairs, setPairs] = useState<[string, string][]>(
    Object.entries(existing).length > 0
      ? Object.entries(existing)
      : [["", ""]]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const filtered = pairs.filter(([k]) => k.trim() !== "");
      const record = Object.fromEntries(filtered);
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverName: server.name,
          scope: server.scope,
          updates: { [fieldKey]: record },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [pairs, server.name, server.scope, fieldKey, onSaved]);

  return (
    <div className="mt-3 rounded-md border border-dashed p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {isStdio ? "Environment Variables" : "HTTP Headers"}
      </p>
      <KeyValueEditor pairs={pairs} onChange={setPairs} keyLabel={keyLabel} />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
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
  const [showForm, setShowForm] = useState(false);
  const type = getServerType(server.config);
  const env = server.config.env as Record<string, string> | undefined;
  const headers = server.config.headers as Record<string, string> | undefined;

  const canConfigure = server.scope === "project" || server.scope === "local";
  const needsAuth = connectionStatus?.status === "needs_auth";

  // MCP auth operation — single click login
  const mcpAuth = useOperation(`mcp-auth:${server.name}`);
  const authStartedRef = useRef(false);

  const handleLogin = useCallback(async () => {
    if (authStartedRef.current || mcpAuth.isRunning) return;
    authStartedRef.current = true;
    try {
      await mcpAuth.start("mcp-auth", { serverName: server.name });
    } catch (err) {
      console.error("MCP auth failed to start:", err);
    }
  }, [mcpAuth, server.name]);

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
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${scopeColors[server.scope] ?? ""}`}
        >
          {server.scope}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{type}</span>
        <AuthBadge authStatus={server.authStatus} />
        <ConnectionBadge connectionStatus={connectionStatus} />
        <div className="ml-auto flex items-center gap-2">
          {needsAuth && !mcpAuth.isRunning && !mcpAuth.operation && (
            <button
              onClick={handleLogin}
              className="rounded-md border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              Login
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
          {canConfigure && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-muted"
            >
              {showForm ? "Close" : "Configure"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
        {type === "stdio" && (
          <p>
            <span className="font-medium text-foreground">command:</span>{" "}
            <code className="text-xs">
              {String(server.config.command ?? "")}
              {Array.isArray(server.config.args) &&
                server.config.args.length > 0 &&
                ` ${(server.config.args as string[]).join(" ")}`}
            </code>
          </p>
        )}
        {(type === "sse" || type === "http") && (
          <p>
            <span className="font-medium text-foreground">url:</span>{" "}
            <code className="text-xs">
              {String(server.config.url ?? "")}
            </code>
          </p>
        )}

        {env && Object.keys(env).length > 0 && (
          <p>
            <span className="font-medium text-foreground">env:</span>{" "}
            {Object.keys(env).map((k) => (
              <code key={k} className="mr-1 text-xs">
                {k}=***
              </code>
            ))}
          </p>
        )}

        {headers && Object.keys(headers).length > 0 && (
          <p>
            <span className="font-medium text-foreground">headers:</span>{" "}
            {Object.keys(headers).map((k) => (
              <code key={k} className="mr-1 text-xs">
                {k}: ***
              </code>
            ))}
          </p>
        )}
      </div>

      {/* MCP Auth operation log — inline */}
      {mcpAuth.operation && mcpAuth.events.length > 0 && (
        <div className="mt-3">
          <OperationLog
            operationId={mcpAuth.operation.id}
            events={mcpAuth.events}
            isRunning={mcpAuth.isRunning}
            phases={mcpAuth.operation.phases}
          />
        </div>
      )}

      {showForm && (
        <AuthConfigForm
          server={server}
          onSaved={() => {
            setShowForm(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
