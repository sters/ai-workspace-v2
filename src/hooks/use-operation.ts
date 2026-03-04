"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { OperationListItem, OperationType } from "@/types/operation";
import { useSSE } from "./use-sse";

const STORAGE_PREFIX = "aiw-op:";

/**
 * @param storageKey  Optional key to persist the active operation in localStorage.
 *                    When provided, the operation ID is saved so that navigating
 *                    away and returning automatically reconnects to the SSE stream.
 */
export function useOperation(storageKey?: string, initialOperationId?: string) {
  const [operation, setOperation] = useState<OperationListItem | null>(null);
  const restoredRef = useRef(false);

  // ---------- Restore from initialOperationId or localStorage on mount ----------
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    // If an explicit operation ID was provided, fetch it from the server
    if (initialOperationId) {
      fetch(`/api/operations`)
        .then((r) => r.json())
        .then((ops: OperationListItem[]) => {
          const op = ops.find((o) => o.id === initialOperationId);
          if (op) setOperation(op);
        })
        .catch(() => {});
      return;
    }

    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
      if (!raw) return;
      const stored: OperationListItem = JSON.parse(raw);
      // Only restore running operations (completed ones can be shown too)
      if (stored?.id) {
        setOperation(stored);
      }
    } catch (err) {
      console.warn("[use-operation] localStorage restore failed:", err);
    }
  }, [storageKey, initialOperationId]);

  // ---------- SSE ----------
  const { events, connected, error: sseError, notFound: sseNotFound, clear } = useSSE(
    operation?.id ?? null
  );

  // ---------- Persist to localStorage ----------
  useEffect(() => {
    if (!storageKey) return;
    if (operation) {
      localStorage.setItem(
        `${STORAGE_PREFIX}${storageKey}`,
        JSON.stringify(operation)
      );
    } else {
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
    }
  }, [storageKey, operation]);

  // ---------- SSE not found → clear stale stored operation immediately ----------
  useEffect(() => {
    if (sseNotFound && storageKey && operation) {
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
      setOperation(null);
    }
  }, [sseNotFound, storageKey, operation]);

  // ---------- SSE error → clear stale stored operation ----------
  useEffect(() => {
    if (sseError && storageKey && operation) {
      // Server likely restarted and lost the operation
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
      setOperation(null);
    }
  }, [sseError, storageKey, operation]);

  // ---------- Status events → detect __setWorkspace ----------
  useEffect(() => {
    const last = events[events.length - 1];
    if (last?.type === "status" && last.data.startsWith("__setWorkspace:")) {
      const ws = last.data.slice("__setWorkspace:".length);
      setOperation((prev) => (prev ? { ...prev, workspace: ws } : null));
    }
  }, [events]);

  // ---------- Complete event → update status ----------
  // Only react to the pipeline-level complete (no childLabel).
  // Child process completes are tagged with childLabel and don't end the operation.
  useEffect(() => {
    const last = events[events.length - 1];
    if (
      last?.type === "complete" &&
      !last.childLabel &&
      operation?.status === "running"
    ) {
      try {
        const d = JSON.parse(last.data);
        setOperation((prev) =>
          prev
            ? {
                ...prev,
                status: d.exitCode === 0 ? "completed" : "failed",
                completedAt: new Date().toISOString(),
              }
            : null
        );
      } catch (err) {
        console.warn("[use-operation] complete event parse failed:", err);
      }
    }
  }, [events, operation?.status]);

  // ---------- Actions ----------
  const start = useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      clear();
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const op: OperationListItem = await res.json();
      setOperation(op);
      return op;
    },
    [clear]
  );

  const cancel = useCallback(async () => {
    if (!operation) return;
    try {
      await fetch("/api/operations/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: operation.id }),
      });
    } catch (err) {
      console.warn("[use-operation] kill failed:", err);
    }
  }, [operation]);

  const reset = useCallback(() => {
    setOperation(null);
    clear();
    if (storageKey) {
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
    }
  }, [clear, storageKey]);

  const isRunning =
    operation?.status === "running" && (connected || !sseError);

  return { operation, events, connected, isRunning, start, cancel, reset };
}
