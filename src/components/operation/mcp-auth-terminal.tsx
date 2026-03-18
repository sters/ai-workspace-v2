"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import type { McpAuthTerminalProps } from "@/types/components";
import { useTerminal } from "@/hooks/use-terminal";
import { Button } from "../shared/buttons/button";

export function McpAuthTerminal({
  events,
  isRunning,
  operationStatus,
}: McpAuthTerminalProps) {
  const { containerRef, termRef, init } = useTerminal({ readonly: true });
  const writtenCountRef = useRef(0);
  const [logsOpen, setLogsOpen] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Initialize xterm on mount
  useEffect(() => {
    init();
    return () => {
      writtenCountRef.current = 0;
    };
  }, [init]);

  // Write only terminal (PTY) events to xterm
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const terminalEvents = events.filter((e) => e.type === "terminal");
    const alreadyWritten = writtenCountRef.current;

    for (let i = alreadyWritten; i < terminalEvents.length; i++) {
      term.write(terminalEvents[i].data);
    }

    writtenCountRef.current = terminalEvents.length;
  }, [events, termRef]);

  // Status log messages (debug info)
  const statusLogs = useMemo(
    () =>
      events
        .filter((e) => e.type === "status" && !e.data.startsWith("__"))
        .map((e) => e.data),
    [events],
  );

  // Auto-scroll logs when open
  useEffect(() => {
    if (logsOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsOpen, statusLogs.length]);

  const finished = !isRunning && operationStatus;
  const succeeded = operationStatus === "completed";

  const lastStatusMsg =
    !succeeded && finished ? statusLogs[statusLogs.length - 1] : undefined;

  return (
    <div>
      {/* Info banner */}
      <div className="mb-1 flex items-center gap-1.5 rounded-t bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
        {isRunning && (
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        )}
        <span>
          {isRunning
            ? "This terminal is automatically operated by AI. No manual input is required."
            : "Automatic authentication terminal (read-only)"}
        </span>
      </div>

      {/* Terminal */}
      <style>{`.mcp-auth-term, .mcp-auth-term * { cursor: default !important; }`}</style>
      <div
        ref={containerRef}
        className="mcp-auth-term min-h-[200px] bg-[#1a1b26] p-1"
      />

      {/* Completion status */}
      {finished && (
        <div
          className={`mt-1 px-3 py-1.5 text-xs font-medium ${
            succeeded
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {succeeded
            ? "Authentication completed successfully."
            : `Authentication failed.${lastStatusMsg ? ` ${lastStatusMsg}` : ""}`}
        </div>
      )}

      {/* Debug logs */}
      {statusLogs.length > 0 && (
        <div className="mt-1 rounded-b border border-t-0">
          <Button
            variant="ghost-toggle"
            onClick={() => setLogsOpen((v) => !v)}
            className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs hover:bg-muted/40"
          >
            <span className={`transition-transform ${logsOpen ? "rotate-90" : ""}`}>
              &#9654;
            </span>
            Debug logs ({statusLogs.length})
          </Button>
          {logsOpen && (
            <div className="max-h-48 overflow-y-auto border-t px-3 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {statusLogs.map((msg, i) => (
                <div key={i}>{msg}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
