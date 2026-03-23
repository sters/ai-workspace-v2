"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import type { OperationListItem, OperationType } from "@/types/operation";
import { useSSE } from "./use-sse";
import { operationListItemSchema } from "@/lib/runtime-schemas";
import { killOperation } from "@/lib/api";

const STORAGE_PREFIX = "aiw-op:";

/**
 * @param storageKey  Optional key to persist the active operation in localStorage.
 *                    When provided, the operation ID is saved so that navigating
 *                    away and returning automatically reconnects to the SSE stream.
 */
export function useOperation(storageKey?: string, initialOperationId?: string) {
  // Restore from localStorage via lazy initializer (runs once, client-only)
  const [baseOperation, setBaseOperation] = useState<OperationListItem | null>(() => {
    if (typeof window === "undefined" || initialOperationId || !storageKey) return null;
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
      if (!raw) return null;
      const result = operationListItemSchema.safeParse(JSON.parse(raw));
      if (result.success) {
        const op = result.data as OperationListItem;
        if (op.status === "completed" || op.status === "failed") {
          localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
          return null;
        }
        return op;
      }
    } catch (err) {
      console.warn("[use-operation] localStorage restore failed:", err);
    }
    return null;
  });

  // Fetch initial operation by ID (async — setState in callback is OK)
  useEffect(() => {
    if (!initialOperationId) return;
    fetch(`/api/operations`)
      .then((r) => r.json())
      .then((ops: OperationListItem[]) => {
        const op = ops.find((o) => o.id === initialOperationId);
        if (op) setBaseOperation(op);
      })
      .catch(() => {});
  }, [initialOperationId]);

  // ---------- SSE ----------
  const { events, connected, error: sseError, notFound: sseNotFound, clear } = useSSE(
    baseOperation?.id ?? null
  );

  // Clear stale operation during render when SSE reports errors
  if ((sseNotFound || sseError) && baseOperation) {
    setBaseOperation(null);
  }

  // ---------- Derive effective operation from base + events (no effect needed) ----------
  const operation = useMemo(() => {
    if (!baseOperation) return null;

    let result = baseOperation;

    // Detect __setWorkspace (use last occurrence)
    for (const event of events) {
      if (event.type === "status" && event.data.startsWith("__setWorkspace:")) {
        const ws = event.data.slice("__setWorkspace:".length);
        if (result.workspace !== ws) {
          result = { ...result, workspace: ws };
        }
      }
    }

    // Detect pipeline-level complete (no childLabel)
    if (result.status === "running") {
      const completeEvent = events.findLast(
        (e) => e.type === "complete" && !e.childLabel
      );
      if (completeEvent) {
        try {
          const d = JSON.parse(completeEvent.data);
          result = {
            ...result,
            status: d.exitCode === 0 ? "completed" : "failed",
            completedAt: completeEvent.timestamp,
          };
        } catch (err) {
          console.warn("[use-operation] complete event parse failed:", err);
        }
      }
    }

    return result;
  }, [baseOperation, events]);

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
      const json: unknown = await res.json();
      const result = operationListItemSchema.safeParse(json);
      if (!result.success) {
        throw new Error("Invalid operation response from server");
      }
      const op = result.data as OperationListItem;
      setBaseOperation(op);
      return op;
    },
    [clear]
  );

  const cancel = useCallback(async () => {
    if (!baseOperation) return;
    try {
      await killOperation(baseOperation.id);
    } catch (err) {
      console.warn("[use-operation] kill failed:", err);
    }
  }, [baseOperation]);

  const reset = useCallback(() => {
    setBaseOperation(null);
    clear();
    if (storageKey) {
      localStorage.removeItem(`${STORAGE_PREFIX}${storageKey}`);
    }
  }, [clear, storageKey]);

  const isRunning =
    operation?.status === "running" && (connected || !sseError);

  return { operation, events, connected, isRunning, start, cancel, reset };
}
