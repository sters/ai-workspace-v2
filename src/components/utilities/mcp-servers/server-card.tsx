"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOperation } from "@/hooks/use-operation";
import { McpAuthTerminal } from "@/components/operation/mcp-auth-terminal";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { ScopeBadge } from "./scope-badge";
import { ConnectionBadge } from "./connection-badge";
import type { McpServerEntry, McpConnectionStatus } from "@/types/claude";

export function ServerCard({
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
