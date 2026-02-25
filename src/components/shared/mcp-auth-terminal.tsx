"use client";

import { useRef, useEffect } from "react";
import type { OperationEvent } from "@/types/operation";
import "@xterm/xterm/css/xterm.css";

interface McpAuthTerminalProps {
  events: OperationEvent[];
  isRunning: boolean;
  operationStatus?: "running" | "completed" | "failed";
}

const THEME = {
  background: "#1a1b26",
  foreground: "#a9b1d6",
  cursor: "#c0caf5",
  selectionBackground: "#33467c",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

export function McpAuthTerminal({
  events,
  isRunning,
  operationStatus,
}: McpAuthTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  const writtenCountRef = useRef(0);

  // Initialize xterm on mount
  useEffect(() => {
    let disposed = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (disposed || !containerRef.current) return;

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;

      const term = new Terminal({
        cursorBlink: false,
        cursorInactiveStyle: "none",
        disableStdin: true,
        fontSize: 14,
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: { ...THEME, cursor: THEME.background },
      });

      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      xtermRef.current = term;

      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      });
    })();

    return () => {
      disposed = true;
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      fitAddonRef.current = null;
      writtenCountRef.current = 0;
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Write terminal and status events to xterm
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const displayEvents = events.filter(
      (e) => e.type === "terminal" || e.type === "status",
    );
    const alreadyWritten = writtenCountRef.current;

    for (let i = alreadyWritten; i < displayEvents.length; i++) {
      const ev = displayEvents[i];
      if (ev.type === "terminal") {
        term.write(ev.data);
      } else {
        // Status messages: dim gray with prefix, skip internal control events
        const msg = ev.data;
        if (msg.startsWith("__")) continue;
        term.write(`\x1b[2m[status] ${msg}\x1b[0m\r\n`);
      }
    }

    writtenCountRef.current = displayEvents.length;
  }, [events]);

  const finished = !isRunning && operationStatus;
  const succeeded = operationStatus === "completed";

  // Extract the last meaningful status message for the failure banner
  const lastStatusMsg = !succeeded && finished
    ? events
        .filter((e) => e.type === "status" && !e.data.startsWith("__"))
        .map((e) => e.data)
        .pop()
    : undefined;

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
          className={`mt-1 rounded-b px-3 py-1.5 text-xs font-medium ${
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
    </div>
  );
}
