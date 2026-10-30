"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTerminal } from "./use-terminal";
import type { ChatSessionInfo, SessionState, ServerMessage } from "@/types/chat";

const CHAT_WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:${process.env.NEXT_PUBLIC_CHAT_WS_PORT || "3742"}/ws`
    : "";

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

/**
 * The live session of this workspace to attach to: the one this tab last held
 * if it is still running, else the newest. Null when there is none, or when the
 * list cannot be read — starting a session is then the only thing left to do.
 */
async function findLiveSession(workspaceId: string, preferred: string | null): Promise<string | null> {
  try {
    const res = await fetch("/api/chat-sessions");
    if (!res.ok) return null;
    const sessions = ((await res.json()) as ChatSessionInfo[]).filter((s) => s.workspaceId === workspaceId);
    if (preferred && sessions.some((s) => s.id === preferred)) return preferred;
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    return sessions[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** The live session already continuing a Slack thread, which a second one may not resume alongside. */
async function findSlackThreadSession(workspaceId: string, threadKey: string): Promise<string | null> {
  try {
    const res = await fetch("/api/chat-sessions");
    if (!res.ok) return null;
    const sessions = (await res.json()) as ChatSessionInfo[];
    return sessions.find((s) => s.workspaceId === workspaceId && s.slackThread === threadKey)?.id ?? null;
  } catch {
    return null;
  }
}

export function useChatSession(
  workspaceId: string,
  options?: {
    initialPrompt?: string;
    reviewTimestamp?: string;
    researchChat?: boolean;
    task?: string;
    /**
     * The opening message of a new session, even when one is saved: the topic
     * is what the conversation is about, and a resumed session is already
     * about something else.
     */
    discussion?: string;
    /**
     * Called once the options above are spent: a session started with them, or
     * a saved session was resumed instead. The caller clears its handoff here.
     */
    onHandoffDelivered?: () => void;
  },
) {
  // Forward every layout change to the PTY, so the Claude TUI on the other end
  // draws for the viewport the browser actually has. Without this the child
  // keeps its spawn-time size and its boxes and status line wrap.
  const wsRef = useRef<WebSocket | null>(null); // declared here: the callback below reads it
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const { containerRef, termRef, init, dispose } = useTerminal({
    webLinks: true,
    onResize: handleTerminalResize,
    focusOnWindowFocus: true,
  });
  const [state, setState] = useState<SessionState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep latest props in refs so async callbacks always read current values
  const initialPromptRef = useRef(options?.initialPrompt);
  initialPromptRef.current = options?.initialPrompt;
  const reviewTimestampRef = useRef(options?.reviewTimestamp);
  reviewTimestampRef.current = options?.reviewTimestamp;
  const researchChatRef = useRef(options?.researchChat);
  researchChatRef.current = options?.researchChat;
  const taskRef = useRef(options?.task);
  taskRef.current = options?.task;
  const discussionRef = useRef(options?.discussion);
  discussionRef.current = options?.discussion;
  const onHandoffDeliveredRef = useRef(options?.onHandoffDelivered);
  onHandoffDeliveredRef.current = options?.onHandoffDelivered;
  // Once delivered, the options above belong to that session: a later New
  // Session starts blank instead of repeating them.
  const handoffSpentRef = useRef(false);
  const deliverHandoff = useCallback(() => {
    handoffSpentRef.current = true;
    onHandoffDeliveredRef.current?.();
  }, []);

  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Generation counter: incremented before each async session init.
  // After the await, if the counter has moved on, this call is stale.
  const generationRef = useRef(0);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The session this hook last held. localStorage forgets it on a dropped
  // connection, while the session itself keeps running on the server.
  const sessionIdRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
    if (onDataDisposableRef.current) {
      onDataDisposableRef.current.dispose();
      onDataDisposableRef.current = null;
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

  const resumeSession = useCallback(
    async (sessionId: string) => {
      cleanup();
      sessionIdRef.current = sessionId;
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
        // The reconnecting window may be a different size than the one that
        // started the session; the server resizes the PTY after the replay.
        ws.send(JSON.stringify({ type: "resume", sessionId, cols: term.cols, rows: term.rows }));
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
            if (msg.data) term.write(msg.data);
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
              // A task never reaches a resumed session, so it is spent here.
              deliverHandoff();
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
      if (onDataDisposableRef.current) {
        onDataDisposableRef.current.dispose();
      }
      onDataDisposableRef.current = term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });
    },
    [workspaceId, cleanup, init, dispose, termRef, deliverHandoff],
  );

  const startSession = useCallback(async (opening: { startPrompt?: string; slackThread?: string } = {}) => {
    const { startPrompt, slackThread } = opening;
    const replaces = sessionIdRef.current ?? loadChatSession(workspaceId);
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

    const ws = new WebSocket(CHAT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      const spent = handoffSpentRef.current;
      const prompt = spent ? undefined : initialPromptRef.current;
      const review = spent ? undefined : reviewTimestampRef.current;
      const research = spent ? undefined : researchChatRef.current;
      const task = spent ? undefined : taskRef.current;
      const discussion = spent ? undefined : discussionRef.current;
      ws.send(JSON.stringify({ type: "start", workspaceId, cols: term.cols, rows: term.rows, ...(prompt && { initialPrompt: prompt }), ...(review && { reviewTimestamp: review }), ...(research && { researchChat: true }), ...(task && { task }), ...(discussion && { discussion }), ...(startPrompt && { startPrompt }), ...(slackThread && { slackThread }), ...(replaces && { replaces }) }));
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
            sessionIdRef.current = msg.sessionId;
            saveChatSession(workspaceId, msg.sessionId);
          }
          deliverHandoff();
          break;
        case "output":
          if (msg.data) term.write(msg.data);
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
    if (onDataDisposableRef.current) {
      onDataDisposableRef.current.dispose();
    }
    onDataDisposableRef.current = term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });
  }, [workspaceId, cleanup, init, dispose, termRef, deliverHandoff]);

  // Shared by every button that opens a chat, so a burst of clicks across them
  // opens one session rather than one per click.
  const openingRef = useRef(false);

  /**
   * What the Start Chat / New Session buttons do: reattach to a session that is
   * still running — a dropped connection or a resume that gave up loses the
   * session from this tab, not from the server — and start one only when there
   * is none.
   *
   * A saved start prompt always starts a fresh session, replacing a live one:
   * the session it would resume is already about something else.
   */
  const openSession = useCallback(async (startPrompt?: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      if (startPrompt) {
        await startSession({ startPrompt });
        return;
      }
      const live = await findLiveSession(workspaceId, sessionIdRef.current ?? loadChatSession(workspaceId));
      if (live) await resumeSession(live);
      else await startSession();
    } finally {
      openingRef.current = false;
    }
  }, [workspaceId, resumeSession, startSession]);

  /**
   * Continue a Slack thread's conversation here: the server resumes the
   * thread's CLI session. Like a start prompt, it replaces a live plain chat,
   * which is about something else.
   */
  const continueSlackThread = useCallback(async (threadKey: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const live = await findSlackThreadSession(workspaceId, threadKey);
      if (live) await resumeSession(live);
      else await startSession({ slackThread: threadKey });
    } finally {
      openingRef.current = false;
    }
  }, [workspaceId, resumeSession, startSession]);

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

  // Auto-resume on mount if localStorage has a saved session,
  // or auto-start if initialPrompt/reviewTimestamp is provided.
  // A review, research or discussion chat always starts a fresh session (skip resume).
  // With nothing saved, attach to the workspace's live session: one the server
  // started on its own (quick create) is saved in no browser.
  useEffect(() => {
    if (stateRef.current !== "idle") return;
    let cancelled = false;
    if (initialPromptRef.current || reviewTimestampRef.current || researchChatRef.current || discussionRef.current) {
      // Custom prompt requested — start a fresh session regardless of saved
      // state. The saved one stays in localStorage so the start can name it as
      // the session it replaces; "started" overwrites it.
      startSession();
    } else {
      const savedSessionId = loadChatSession(workspaceId);
      if (savedSessionId) {
        // A task never displaces a live session: it would re-run work that
        // session may be half way through, so the task only ever opens a
        // session this hook starts — which also makes reloading the URL safe.
        resumeSession(savedSessionId);
      } else if (taskRef.current) {
        startSession();
      } else {
        void findLiveSession(workspaceId, null).then((live) => {
          if (live && !cancelled && stateRef.current === "idle" && !openingRef.current) {
            resumeSession(live);
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
    containerRef,
    state,
    exitCode,
    error,
    openSession,
    continueSlackThread,
    cancelResume,
    stopSession,
  };
}
