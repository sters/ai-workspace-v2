"use client";

import { useEffect, useRef, useReducer, useState, useCallback } from "react";
import type { OperationEvent } from "@/types/operation";
import { operationEventSchema } from "@/lib/runtime-schemas";

type EventAction = { type: "append"; events: OperationEvent[] } | { type: "clear" };

function eventsReducer(state: OperationEvent[], action: EventAction): OperationEvent[] {
  if (action.type === "clear") return [];
  return state.concat(action.events);
}

export function useSSE(operationId: string | null) {
  const [events, dispatch] = useReducer(eventsReducer, []);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const batchRef = useRef<OperationEvent[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!operationId) return;

    setError(false);
    setNotFound(false);
    let retryCount = 0;

    const connect = async () => {
      // Clear stale events before (re)connecting — the server replays all events
      dispatch({ type: "clear" });
      batchRef.current = [];

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/events?operationId=${encodeURIComponent(operationId)}`,
          { signal: controller.signal }
        );

        if (res.status === 404) {
          setNotFound(true);
          return;
        }

        if (!res.ok || !res.body) {
          throw new Error(`SSE failed: ${res.status}`);
        }

        const contentType = res.headers.get("Content-Type") ?? "";

        // ---------- JSON response (completed operations) ----------
        if (contentType.includes("application/json")) {
          const data: OperationEvent[] = await res.json();
          dispatch({ type: "append", events: data });
          setConnected(false);
          return;
        }

        // ---------- SSE stream (running operations) ----------
        setConnected(true);
        setError(false);
        retryCount = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = operationEventSchema.safeParse(JSON.parse(line.slice(6)));
              if (!parsed.success) continue;
              const event = parsed.data as OperationEvent;
              batchRef.current.push(event);
              if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(() => {
                  rafRef.current = 0;
                  dispatch({ type: "append", events: batchRef.current });
                  batchRef.current = [];
                });
              }
              // Only close on the pipeline-level complete (no childLabel).
              // Child process completes are tagged with childLabel and should not end the stream.
              if (event.type === "complete" && !event.childLabel) {
                setConnected(false);
                return;
              }
            } catch (err) {
              console.warn("[use-sse] parse error:", line, err);
            }
          }
        }

        setConnected(false);
      } catch {
        if (controller.signal.aborted) return;
        setConnected(false);

        if (retryCount < 2) {
          retryCount++;
          setTimeout(connect, 1000);
        } else {
          setError(true);
        }
      }
    };

    connect();

    return () => {
      abortRef.current?.abort();
      setConnected(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      // Flush any remaining batched events before cleanup
      if (batchRef.current.length > 0) {
        dispatch({ type: "append", events: batchRef.current });
        batchRef.current = [];
      }
    };
  }, [operationId]);

  const clear = useCallback(() => {
    dispatch({ type: "clear" });
    batchRef.current = [];
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setError(false);
    setNotFound(false);
  }, []);

  return { events, connected, error, notFound, clear };
}
