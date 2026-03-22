"use client";

import { useState, useMemo } from "react";
import { OperationSummary, useNow } from "@/components/operation/operation-summary";
import { OperationInputs } from "@/components/operation/operation-inputs";
import { OperationLog } from "@/components/operation/log";
import { Button } from "@/components/shared/buttons/button";
import { Card } from "@/components/shared/containers/card";
import { Spinner } from "@/components/shared/feedback/spinner";
import { ResultBox } from "@/components/shared/feedback/result-box";
import { useSSE } from "@/hooks/use-sse";
import { parsePhaseUpdatesFromEvents } from "@/lib/parse-phase-updates";
import type { OperationCardProps } from "@/types/components";

export function OperationCard({
  operation,
  onStartOperation,
  onCancel,
  defaultExpanded,
}: OperationCardProps) {
  const isRunning = operation.status === "running";
  const isDone = operation.status === "completed" || operation.status === "failed";
  const [expanded, setExpanded] = useState(defaultExpanded ?? isRunning);
  const [retrying, setRetrying] = useState(false);
  const now = useNow(isRunning ? 1000 : 0);

  // Only connect SSE when expanded (for log viewing)
  const sseOperationId = expanded ? operation.id : null;
  const { events, connected } = useSSE(sseOperationId);

  // Derive live phases from SSE events
  const livePhases = useMemo(
    () => parsePhaseUpdatesFromEvents(events),
    [events],
  );

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

  // Detect pending ask from SSE events (lightweight check on raw events)
  const liveHasPendingAsk = useMemo(() => {
    if (liveStatus !== "running") return false;
    // Track ask tool_use IDs and answered tool_result IDs
    const askIds = new Set<string>();
    const answeredIds = new Set<string>();
    for (const ev of events) {
      if (ev.type !== "output") continue;
      if (ev.data.includes('"AskUserQuestion"')) {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.type === "assistant" && Array.isArray(parsed.message?.content)) {
            for (const block of parsed.message.content) {
              if (block.type === "tool_use" && block.name === "AskUserQuestion") {
                askIds.add(block.id);
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (ev.data.includes('"tool_result"')) {
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed.type === "user" && Array.isArray(parsed.message?.content)) {
            for (const block of parsed.message.content) {
              if (block.type === "tool_result" && block.tool_use_id) {
                answeredIds.add(block.tool_use_id);
              }
            }
          }
        } catch { /* ignore */ }
      }
    }
    for (const id of askIds) {
      if (!answeredIds.has(id)) return true;
    }
    return false;
  }, [events, liveStatus]);

  const effectiveOperation = {
    ...operation,
    status: liveStatus,
    ...(livePhases && { currentPhase: livePhases.find((p) => p.status === "running") }),
    hasPendingAsk: liveHasPendingAsk || operation.hasPendingAsk,
  };
  const effectiveIsRunning = liveStatus === "running" && (connected || isRunning);

  // Use resultSummary from the operation list item (no SSE needed for results)
  const resultSummary = operation.resultSummary;

  return (
    <Card variant="flush">
      {/* Header */}
      <div className="flex items-center gap-2 p-3">
        <Button
          variant="ghost-toggle"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0"
          aria-label={expanded ? "Collapse operation" : "Expand operation"}
        >
          {expanded ? "\u25BC" : "\u25B6"}
        </Button>
        <OperationSummary operation={effectiveOperation} now={now} />
        <div className="flex shrink-0 items-center gap-2">
          {effectiveIsRunning ? (
            <Button variant="destructive-sm" onClick={() => onCancel(operation.id)}>
              Cancel
            </Button>
          ) : isDone ? (
            <>
              {operation.type !== "delete" && (
                <Button
                  variant="outline"
                  disabled={retrying}
                  onClick={async () => {
                    setRetrying(true);
                    try {
                      await onStartOperation(operation.type, {
                        workspace: operation.workspace,
                        ...operation.inputs,
                      });
                    } finally {
                      setRetrying(false);
                    }
                  }}
                >
                  {retrying ? "Starting…" : "Retry"}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Inputs (shown when expanded) */}
      {expanded && operation.inputs && Object.keys(operation.inputs).length > 0 && (
        <div className="border-t p-3">
          <OperationInputs inputs={operation.inputs} />
        </div>
      )}

      {/* Expanded body: full OperationLog */}
      {expanded && events.length > 0 && (
        <div className="border-t p-3">
          <OperationLog
            operationId={operation.id}
            events={events}
            isRunning={effectiveIsRunning}
          />
        </div>
      )}

      {/* Starting indicator */}
      {expanded && effectiveIsRunning && events.length === 0 && (
        <div className="border-t p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Operation starting…
          </div>
        </div>
      )}

      {/* Result summary (always visible when done, even when collapsed) */}
      {!effectiveIsRunning && resultSummary && (
        <div className="border-t p-3">
          <ResultBox
            content={resultSummary.content}
            cost={resultSummary.cost}
            duration={resultSummary.duration}
          />
        </div>
      )}

    </Card>
  );
}
