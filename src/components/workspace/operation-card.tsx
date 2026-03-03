"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { OperationSummary, useNow } from "@/components/operation/operation-summary";
import { OperationLog } from "@/components/operation/log";
import { NextActionSuggestions } from "@/components/operation/next-action-suggestions";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { useSSE } from "@/hooks/use-sse";
import { parseStreamEvent } from "@/lib/parsers/stream";
import type { Operation, OperationType, OperationPhaseInfo } from "@/types/operation";
import type { LogEntry } from "@/types/claude";

interface OperationCardProps {
  operation: Operation;
  /** Called when user starts a new operation from next-action suggestions. */
  onStartOperation: (type: OperationType, body: Record<string, string>) => Promise<void>;
  /** Called when user clicks Cancel on a running operation. */
  onCancel: (operationId: string) => void;
  /** Called when user clicks Clear on a finished operation. */
  onClear: (operationId: string) => void;
  /** Whether this card should be expanded by default. */
  defaultExpanded?: boolean;
}

export function OperationCard({
  operation,
  onStartOperation,
  onCancel,
  onClear,
  defaultExpanded,
}: OperationCardProps) {
  const isRunning = operation.status === "running";
  const isDone = operation.status === "completed" || operation.status === "failed";
  const [expanded, setExpanded] = useState(defaultExpanded ?? isRunning);
  const now = useNow(isRunning ? 1000 : 0);

  // Collapse when the operation finishes
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      setExpanded(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  // Only connect SSE when expanded
  const sseOperationId = expanded ? operation.id : null;
  const { events, connected } = useSSE(sseOperationId);

  // Derive live phases from SSE events
  const livePhases = useMemo(() => {
    if (!operation.phases || operation.phases.length === 0) return operation.phases;
    const phaseMap = new Map<number, OperationPhaseInfo>();
    for (const p of operation.phases) {
      phaseMap.set(p.index, { ...p });
    }
    for (const event of events) {
      if (event.type === "status" && event.data.startsWith("__phaseUpdate:")) {
        try {
          const data = JSON.parse(event.data.slice("__phaseUpdate:".length));
          const existing = phaseMap.get(data.phaseIndex);
          if (existing) {
            existing.status = data.phaseStatus;
          }
        } catch {
          // ignore
        }
      }
    }
    return Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
  }, [operation.phases, events]);

  // Detect live status from SSE (complete event)
  const liveStatus = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === "complete" && !ev.childLabel) {
        try {
          const d = JSON.parse(ev.data);
          return d.exitCode === 0 ? "completed" : "failed";
        } catch {
          return "failed";
        }
      }
    }
    return operation.status;
  }, [events, operation.status]);

  const effectiveOperation = { ...operation, status: liveStatus, phases: livePhases };
  const effectiveIsRunning = liveStatus === "running" && (connected || isRunning);

  // Extract result entries for summary display
  const resultEntries = useMemo(() => {
    if (effectiveIsRunning) return [];
    const results: LogEntry[] = [];
    for (const event of events) {
      if (event.type === "output") {
        const parsed = parseStreamEvent(event.data);
        for (const entry of parsed) {
          if (entry.kind === "result") {
            results.push(entry);
          }
        }
      }
    }
    return results;
  }, [effectiveIsRunning, events]);

  const lastResult = resultEntries.length > 0 ? resultEntries[resultEntries.length - 1] : null;

  return (
    <div className="rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? "\u25BC" : "\u25B6"}
        </button>
        <OperationSummary operation={effectiveOperation} now={now} />
        <div className="flex shrink-0 items-center gap-2">
          {effectiveIsRunning ? (
            <button
              onClick={() => onCancel(operation.id)}
              className="rounded-md border border-destructive/50 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              Cancel
            </button>
          ) : isDone ? (
            <>
              {operation.type !== "delete" && (
                <button
                  onClick={() =>
                    onStartOperation(operation.type, {
                      workspace: operation.workspace,
                    })
                  }
                  className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => onClear(operation.id)}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Expanded body: full OperationLog */}
      {expanded && events.length > 0 && (
        <div className="border-t p-3">
          <OperationLog
            operationId={operation.id}
            events={events}
            isRunning={effectiveIsRunning}
            phases={livePhases}
          />
        </div>
      )}

      {/* Starting indicator */}
      {expanded && effectiveIsRunning && events.length === 0 && (
        <div className="border-t p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Operation starting…
          </div>
        </div>
      )}

      {/* Result summary (always visible when done, even when collapsed) */}
      {!effectiveIsRunning && lastResult && lastResult.kind === "result" && (
        <div className="border-t p-3">
          <div className="rounded-md bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
            <MarkdownRenderer content={lastResult.content} />
            {(lastResult.cost || lastResult.duration) && (
              <div className="mt-1 text-xs opacity-70">
                {[lastResult.cost, lastResult.duration].filter(Boolean).join(" | ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Next action suggestions */}
      {!effectiveIsRunning && liveStatus !== "running" && liveStatus !== "failed" && operation.workspace && (
        <div className="border-t p-3">
          <NextActionSuggestions
            operationType={operation.type}
            workspace={operation.workspace}
            onStart={onStartOperation}
            isRunning={false}
          />
        </div>
      )}
    </div>
  );
}
