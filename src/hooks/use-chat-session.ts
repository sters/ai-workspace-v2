"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTerminal } from "./use-terminal";
import {
  isSessionBusy,
  readTurnProgress,
  UNKNOWN_TURN_PROGRESS,
  type TurnProgress,
} from "@/lib/chat-server/activity";
import type { SessionState, ServerMessage } from "@/types/chat";

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

// ---------------------------------------------------------------------------
// Draft paste
// ---------------------------------------------------------------------------

const DRAFT_POLL_MS = 200;
/** Output settles for this long before a paste, even after a turn-end marker. */
const DRAFT_MIN_QUIET_MS = 300;
/** A session still working after this is reported rather than pasted into. */
const DRAFT_PASTE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Whether the TUI is sitting at its prompt, so pasted text lands in the prompt
 * box. The same reading as the sidebar's busy flag, with one difference: a turn
 * known to be open is never ready, even when quiet — quiet with a turn open is
 * a permission prompt, and a paste there answers it.
 */
function readyForDraft(output: { at: number; seen: boolean; progress: TurnProgress }, now: number): boolean {
  if (!output.seen || output.progress.inFlight === true) return false;
  if (now - output.at < DRAFT_MIN_QUIET_MS) return false;
  return !isSessionBusy({ lastOutputAt: output.at, progress: output.progress }, now);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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
     * Pasted into the prompt box of whichever session opens — resumed or new —
     * and left unsent, so the user adds their question and sends it.
     */
    draft?: string;
    /**
     * Called once the options above have reached a session: after its start,
     * or after the draft was pasted. The caller clears its handoff here.
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
  const draftRef = useRef(options?.draft);
  draftRef.current = options?.draft;
  const onHandoffDeliveredRef = useRef(options?.onHandoffDelivered);
  onHandoffDeliveredRef.current = options?.onHandoffDelivered;
  /** A draft is pasted once per mount, not once per session this mount opens. */
  const draftPastedRef = useRef(false);
  const outputRef = useRef({ at: 0, seen: false, progress: UNKNOWN_TURN_PROGRESS });
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for websocket (survive re-renders)
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Generation counter: incremented before each async session init.
  // After the await, if the counter has moved on, this call is stale.
  const generationRef = useRef(0);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopDraftTimer = useCallback(() => {
    if (draftTimerRef.current) {
      clearInterval(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, []);

  const noteOutput = useCallback((data: string) => {
    outputRef.current = {
      at: Date.now(),
      seen: true,
      progress: readTurnProgress(data, outputRef.current.progress),
    };
  }, []);

  /** The session is open: paste the draft when it is at its prompt, then report delivery. */
  const deliverHandoff = useCallback(
    (term: { paste: (data: string) => void; focus?: () => void }) => {
      const draft = draftRef.current;
      if (!draft || draftPastedRef.current) {
        onHandoffDeliveredRef.current?.();
        return;
      }
      stopDraftTimer();
      const deadline = Date.now() + DRAFT_PASTE_TIMEOUT_MS;
      draftTimerRef.current = setInterval(() => {
        const now = Date.now();
        if (readyForDraft(outputRef.current, now)) {
          stopDraftTimer();
          draftPastedRef.current = true;
          // `paste` rather than a raw input frame: xterm wraps it in bracketed
          // paste when the TUI asked for that, so newlines stay in the box
          // instead of each one sending a line.
          term.paste(draft);
          term.focus?.();
          onHandoffDeliveredRef.current?.();
        } else if (now > deadline) {
          stopDraftTimer();
          setError("The session stayed busy, so the selected changes were not pasted. Reload to try again.");
        }
      }, DRAFT_POLL_MS);
    },
    [stopDraftTimer],
  );

  const cleanup = useCallback(() => {
    stopDraftTimer();
    outputRef.current = { at: 0, seen: false, progress: UNKNOWN_TURN_PROGRESS };
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
  }, [dispose, stopDraftTimer]);

  // Cleanup on unmount — close WS + dispose xterm, but keep localStorage
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

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
            if (msg.data) {
              term.write(msg.data);
              noteOutput(msg.data);
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
              deliverHandoff(term);
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
    [workspaceId, cleanup, init, dispose, termRef, noteOutput, deliverHandoff],
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
      const research = researchChatRef.current;
      const task = taskRef.current;
      const discussion = discussionRef.current;
      ws.send(JSON.stringify({ type: "start", workspaceId, cols: term.cols, rows: term.rows, ...(prompt && { initialPrompt: prompt }), ...(review && { reviewTimestamp: review }), ...(research && { researchChat: true }), ...(task && { task }), ...(discussion && { discussion }) }));
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
          deliverHandoff(term);
          break;
        case "output":
          if (msg.data) {
            term.write(msg.data);
            noteOutput(msg.data);
          }
          break;
        case "exited":
          stopDraftTimer();
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
  }, [workspaceId, cleanup, init, dispose, termRef, noteOutput, deliverHandoff, stopDraftTimer]);

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
  // A draft goes to whichever session opens, so it resumes like a plain visit.
  useEffect(() => {
    if (stateRef.current !== "idle") return;
    if (initialPromptRef.current || reviewTimestampRef.current || researchChatRef.current || discussionRef.current) {
      // Custom prompt requested — start a fresh session regardless of saved state
      clearChatSession(workspaceId);
      startSession();
    } else {
      const savedSessionId = loadChatSession(workspaceId);
      if (savedSessionId) {
        // A task never displaces a live session: it would re-run work that
        // session may be half way through, so the task only ever opens a
        // session this hook starts — which also makes reloading the URL safe.
        resumeSession(savedSessionId);
      } else if (taskRef.current || draftRef.current) {
        startSession();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
    containerRef,
    state,
    exitCode,
    error,
    startSession,
    cancelResume,
    stopSession,
  };
}
