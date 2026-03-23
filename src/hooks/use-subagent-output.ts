"use client";

import { useEffect, useRef, useState } from "react";
import type { SubagentOutputState } from "@/types/hooks";

/**
 * Stream sub-agent output file content via SSE.
 * Connects to /api/subagent-output (SSE) when enabled and accumulates chunks.
 */
export function useSubagentOutput(
  outputFile: string | undefined,
  enabled: boolean
): SubagentOutputState {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Track previous props with state to reset when they change (React recommended pattern)
  const [prevFile, setPrevFile] = useState(outputFile);
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  if (prevFile !== outputFile || prevEnabled !== enabled) {
    setPrevFile(outputFile);
    setPrevEnabled(enabled);
    if (!enabled || !outputFile) {
      if (loading) setLoading(false);
      if (content) setContent("");
      if (error) setError(false);
    } else {
      setContent("");
      setError(false);
      setLoading(true);
    }
  }

  // Manage EventSource connection — setState only in callbacks
  useEffect(() => {
    if (!enabled || !outputFile) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      return;
    }

    const es = new EventSource(
      `/api/subagent-output?path=${encodeURIComponent(outputFile)}`
    );
    esRef.current = es;

    es.onopen = () => {
      setLoading(false);
      setError(false);
    };

    es.onmessage = (e) => {
      try {
        const data: { content?: string; error?: string } = JSON.parse(e.data);
        if (data.content) {
          setContent((prev) => prev + data.content);
        }
        if (data.error) {
          setError(true);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setError(true);
      setLoading(false);
      es.close(); // Stop automatic reconnection
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [enabled, outputFile]);

  return { content, loading, error };
}
