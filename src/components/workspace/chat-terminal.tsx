"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

const CHAT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:${process.env.NEXT_PUBLIC_CHAT_WS_PORT || "3742"}/ws`
    : "";

type SessionState = "idle" | "connecting" | "running" | "exited";

interface ServerMessage {
  type: "output" | "started" | "exited" | "error";
  data?: string;
  sessionId?: string;
  code?: number;
  message?: string;
}

export function ChatTerminal({ workspaceId }: { workspaceId: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for xterm and websocket (survive re-renders)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    fitAddonRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore fit errors during transitions
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const startSession = useCallback(async () => {
    cleanup();
    setState("connecting");
    setExitCode(null);
    setError(null);

    // Dynamic import to avoid SSR issues
    const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-web-links"),
    ]);

    if (!termRef.current) return;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
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
      },
    });
    xtermRef.current = term;

    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);

    // Wait a tick for the terminal to be in the DOM
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    });

    // Connect WebSocket
    const ws = new WebSocket(CHAT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", workspaceId }));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "started":
          setState("running");
          break;
        case "output":
          if (msg.data) {
            term.write(msg.data);
          }
          break;
        case "exited":
          setState("exited");
          setExitCode(msg.code ?? -1);
          break;
        case "error":
          setError(msg.message ?? "Unknown error");
          setState("exited");
          break;
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection failed. Is the chat server running?");
      setState("exited");
    };

    ws.onclose = () => {
      if (stateRef.current === "running" || stateRef.current === "connecting") {
        setState("exited");
      }
    };

    // Forward terminal input to WebSocket
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });
  }, [workspaceId, cleanup]);

  const stopSession = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "kill" }));
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {state === "idle" && (
          <button
            onClick={startSession}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Start Chat
          </button>
        )}
        {state === "connecting" && (
          <span className="text-sm text-muted-foreground">Connecting...</span>
        )}
        {state === "running" && (
          <button
            onClick={stopSession}
            className="rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Stop
          </button>
        )}
        {state === "exited" && (
          <>
            <span className="text-sm text-muted-foreground">
              Session ended{exitCode !== null ? ` (code ${exitCode})` : ""}
            </span>
            <button
              onClick={startSession}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              New Session
            </button>
          </>
        )}
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={termRef}
        className="min-h-0 flex-1 bg-[#1a1b26] p-1"
        style={{
          display: state === "idle" ? "none" : "block",
        }}
      />

      {/* Idle state placeholder */}
      {state === "idle" && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-lg font-medium">
              Interactive Chat
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Start an interactive Claude session to discuss this workspace
            </p>
            <button
              onClick={startSession}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start Chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
