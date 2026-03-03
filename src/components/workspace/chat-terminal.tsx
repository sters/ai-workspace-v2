"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

const CHAT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:${process.env.NEXT_PUBLIC_CHAT_WS_PORT || "3742"}/ws`
    : "";

type SessionState = "idle" | "connecting" | "resuming" | "running" | "exited";

interface ServerMessage {
  type: "output" | "started" | "exited" | "error" | "resumed" | "replay_done";
  data?: string;
  sessionId?: string;
  code?: number;
  message?: string;
  exited?: boolean;
  exitCode?: number;
  bufferedChunks?: number;
}

// ---------------------------------------------------------------------------
// Terminal theme (shared between start and resume)
// ---------------------------------------------------------------------------

const TERMINAL_THEME = {
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
} as const;

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function chatStorageKey(workspaceId: string): string {
  return `aiw-chat:${workspaceId}`;
}

function saveChatSession(workspaceId: string, sessionId: string): void {
  try {
    localStorage.setItem(chatStorageKey(workspaceId), JSON.stringify({ sessionId }));
  } catch {
    // ignore quota errors
  }
}

function loadChatSession(workspaceId: string): string | null {
  try {
    const raw = localStorage.getItem(chatStorageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.sessionId ?? null;
  } catch {
    return null;
  }
}

function clearChatSession(workspaceId: string): void {
  try {
    localStorage.removeItem(chatStorageKey(workspaceId));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Terminal initialization helper
// ---------------------------------------------------------------------------

interface TerminalBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  term: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fitAddon: any;
}

async function initTerminal(container: HTMLElement): Promise<TerminalBundle> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
  ]);

  // Clear any residual DOM from a previous xterm instance to prevent
  // duplicate terminals when re-mounting after tab navigation.
  container.innerHTML = "";

  const fitAddon = new FitAddon();
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: TERMINAL_THEME,
  });

  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(container);

  requestAnimationFrame(() => {
    try {
      fitAddon.fit();
    } catch {
      // ignore fit errors during transitions
    }
  });

  return { term, fitAddon };
}

// ---------------------------------------------------------------------------
// ChatTerminal component
// ---------------------------------------------------------------------------

export function ChatTerminal({ workspaceId, initialPrompt, reviewTimestamp }: { workspaceId: string; initialPrompt?: string; reviewTimestamp?: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SessionState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep latest props in refs so async callbacks always read current values
  const initialPromptRef = useRef(initialPrompt);
  initialPromptRef.current = initialPrompt;
  const reviewTimestampRef = useRef(reviewTimestamp);
  reviewTimestampRef.current = reviewTimestamp;

  // Refs for xterm and websocket (survive re-renders)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Generation counter: incremented before each async session init.
  // After the await, if the counter has moved on, this call is stale.
  const generationRef = useRef(0);

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

  // Cleanup on unmount — close WS + dispose xterm, but keep localStorage
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

  // Auto-resume on mount if localStorage has a saved session,
  // or auto-start if initialPrompt/reviewTimestamp is provided.
  // When reviewTimestamp is set, always start a fresh session (skip resume).
  useEffect(() => {
    if (stateRef.current !== "idle") return;
    if (initialPromptRef.current || reviewTimestampRef.current) {
      // Custom prompt requested — start a fresh session regardless of saved state
      clearChatSession(workspaceId);
      startSession();
    } else {
      const savedSessionId = loadChatSession(workspaceId);
      if (savedSessionId) {
        resumeSession(savedSessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      cleanup();
      const gen = ++generationRef.current;
      setState("resuming");
      setExitCode(null);
      setError(null);

      if (!termRef.current) return;

      const { term, fitAddon } = await initTerminal(termRef.current);

      // If another session init started while we awaited, abandon this one.
      if (generationRef.current !== gen) {
        term.dispose();
        return;
      }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      const ws = new WebSocket(CHAT_WS_URL);
      wsRef.current = ws;

      // Track whether the resumed session had already exited
      let resumedExited = false;
      let resumedExitCode: number | undefined;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "resume", sessionId }));
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "resumed":
            resumedExited = msg.exited ?? false;
            resumedExitCode = msg.exitCode;
            break;
          case "output":
            if (msg.data) {
              term.write(msg.data);
            }
            break;
          case "replay_done":
            if (resumedExited) {
              setState("exited");
              setExitCode(resumedExitCode ?? -1);
            } else {
              setState("running");
            }
            break;
          case "exited":
            setState("exited");
            setExitCode(msg.code ?? -1);
            break;
          case "error":
            // Session not found — clear localStorage, go idle
            clearChatSession(workspaceId);
            setError(null);
            setState("idle");
            cleanup();
            break;
        }
      };

      ws.onerror = () => {
        clearChatSession(workspaceId);
        setError("WebSocket connection failed. Is the chat server running?");
        setState("exited");
      };

      ws.onclose = () => {
        if (stateRef.current === "running" || stateRef.current === "resuming") {
          setState("exited");
        }
      };

      // Forward terminal input to WebSocket
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    },
    [workspaceId, cleanup],
  );

  const startSession = useCallback(async () => {
    cleanup();
    const gen = ++generationRef.current;
    setState("connecting");
    setExitCode(null);
    setError(null);

    if (!termRef.current) return;

    const { term, fitAddon } = await initTerminal(termRef.current);

    // If another session init started while we awaited, abandon this one.
    if (generationRef.current !== gen) {
      term.dispose();
      return;
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect WebSocket
    const ws = new WebSocket(CHAT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      const prompt = initialPromptRef.current;
      const review = reviewTimestampRef.current;
      ws.send(JSON.stringify({ type: "start", workspaceId, ...(prompt && { initialPrompt: prompt }), ...(review && { reviewTimestamp: review }) }));
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
          // Save session to localStorage for resume
          if (msg.sessionId) {
            saveChatSession(workspaceId, msg.sessionId);
          }
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
    // Clear localStorage on explicit kill
    clearChatSession(workspaceId);
  }, [workspaceId]);

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
        {state === "resuming" && (
          <span className="text-sm text-muted-foreground">Reconnecting...</span>
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
