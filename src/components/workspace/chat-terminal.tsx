"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTerminal } from "@/hooks/use-terminal";
import { Button } from "../shared/buttons/button";
import { StatusText } from "../shared/feedback/status-text";

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
// ChatTerminal component
// ---------------------------------------------------------------------------

export function ChatTerminal({ workspaceId, initialPrompt, reviewTimestamp }: { workspaceId: string; initialPrompt?: string; reviewTimestamp?: string }) {
  const { containerRef, termRef, init, dispose } = useTerminal({ webLinks: true });
  const [state, setState] = useState<SessionState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep latest props in refs so async callbacks always read current values
  const initialPromptRef = useRef(initialPrompt);
  initialPromptRef.current = initialPrompt;
  const reviewTimestampRef = useRef(reviewTimestamp);
  reviewTimestampRef.current = reviewTimestamp;

  // Refs for websocket (survive re-renders)
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Generation counter: incremented before each async session init.
  // After the await, if the counter has moved on, this call is stale.
  const generationRef = useRef(0);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    dispose();
  }, [dispose]);

  // Cleanup on unmount — close WS + dispose xterm, but keep localStorage
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

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

      // Wait one frame so React commits the state update and the container
      // becomes visible (switches from display:none to display:block).
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      if (generationRef.current !== gen) { dispose(); return; }

      try {
        await init();
      } catch {
        clearChatSession(workspaceId);
        setState("idle");
        return;
      }

      // If another session init started while we awaited, abandon this one.
      if (generationRef.current !== gen) {
        dispose();
        return;
      }

      const term = termRef.current;
      if (!term) {
        clearChatSession(workspaceId);
        setState("idle");
        return;
      }

      const ws = new WebSocket(CHAT_WS_URL);
      wsRef.current = ws;

      // Track whether the resumed session had already exited
      let resumedExited = false;
      let resumedExitCode: number | undefined;

      // Timeout: if resume doesn't complete in 5s, give up and go idle
      resumeTimeoutRef.current = setTimeout(() => {
        if (stateRef.current === "resuming") {
          clearChatSession(workspaceId);
          setError(null);
          setState("idle");
          cleanup();
        }
      }, 5000);

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
            if (resumeTimeoutRef.current) {
              clearTimeout(resumeTimeoutRef.current);
              resumeTimeoutRef.current = null;
            }
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
        if (stateRef.current === "running") {
          setState("exited");
        } else if (stateRef.current === "resuming") {
          // Resume failed — clear saved session and go idle so user can start fresh
          clearChatSession(workspaceId);
          if (resumeTimeoutRef.current) {
            clearTimeout(resumeTimeoutRef.current);
            resumeTimeoutRef.current = null;
          }
          setState("idle");
        }
      };

      // Forward terminal input to WebSocket
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    },
    [workspaceId, cleanup, init, dispose, termRef],
  );

  const startSession = useCallback(async () => {
    cleanup();
    const gen = ++generationRef.current;
    setState("connecting");
    setExitCode(null);
    setError(null);

    // Wait one frame so React commits the state update and the container
    // becomes visible (switches from display:none to display:block).
    // xterm.js needs a visible container with non-zero dimensions to init.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (generationRef.current !== gen) { dispose(); return; }

    try {
      await init();
    } catch {
      clearChatSession(workspaceId);
      setError("Failed to initialize terminal");
      setState("exited");
      return;
    }

    // If another session init started while we awaited, abandon this one.
    if (generationRef.current !== gen) {
      dispose();
      return;
    }

    const term = termRef.current;
    if (!term) {
      clearChatSession(workspaceId);
      setError("Failed to initialize terminal");
      setState("exited");
      return;
    }

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
          clearChatSession(workspaceId);
          setError(msg.message ?? "Unknown error");
          setState("exited");
          break;
      }
    };

    ws.onerror = () => {
      clearChatSession(workspaceId);
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
  }, [workspaceId, cleanup, init, dispose, termRef]);

  const cancelResume = useCallback(() => {
    clearChatSession(workspaceId);
    setError(null);
    setState("idle");
    cleanup();
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
          <Button onClick={startSession}>Start Chat</Button>
        )}
        {state === "connecting" && (
          <StatusText>Connecting...</StatusText>
        )}
        {state === "resuming" && (
          <>
            <StatusText>Reconnecting...</StatusText>
            <Button variant="ghost" onClick={cancelResume}>Cancel</Button>
          </>
        )}
        {state === "running" && (
          <Button variant="destructive" onClick={stopSession}>Stop</Button>
        )}
        {state === "exited" && (
          <>
            <StatusText>
              Session ended{exitCode !== null ? ` (code ${exitCode})` : ""}
            </StatusText>
            <Button onClick={startSession}>New Session</Button>
          </>
        )}
        {error && (
          <StatusText variant="error">{error}</StatusText>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
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
            <Button onClick={startSession}>Start Chat</Button>
          </div>
        </div>
      )}
    </div>
  );
}
