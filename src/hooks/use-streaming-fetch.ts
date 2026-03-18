import { useState, useCallback, useRef } from "react";
import type { OperationEvent } from "@/types/operation";

/**
 * Hook for streaming fetch (SSE-style line-delimited JSON responses).
 * Extracts event handling from quick-ask and other streaming components.
 */
export function useStreamingFetch() {
  const [events, setEvents] = useState<OperationEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (url: string, body: Record<string, unknown>) => {
    setEvents([]);
    setError(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: OperationEvent = JSON.parse(line.slice(6));
            setEvents((prev) => [...prev, event]);
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Failed");
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setEvents([]);
    setError(null);
  }, []);

  return { events, isRunning, error, run, cancel, reset };
}
