"use client";

import { useMemo, useState } from "react";
import { OperationLog } from "./log";
import { ResultBox } from "../shared/feedback/result-box";
import { parseStreamEvent } from "@/lib/parsers/stream";
import type { LogEntry } from "@/types/claude";
import type { OperationListItem, OperationEvent } from "@/types/operation";

/**
 * Wraps OperationLog with collapse/expand behavior.
 * - Expanded by default (stays expanded after completion)
 * - Result entries (green output) are always visible outside the fold
 */
export function CollapsibleOperationLog({
  operation,
  isRunning,
  events,
}: {
  operation: OperationListItem;
  isRunning: boolean;
  events: OperationEvent[];
}) {
  const [expanded, setExpanded] = useState(true);

  const isDone = !isRunning && (operation.status === "completed" || operation.status === "failed");

  // Extract result entries from events so they can be shown outside the fold
  const resultEntries = useMemo(() => {
    if (!isDone) return [];
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
  }, [isDone, events]);

  // Count log entries (excluding results) for the header
  const logEntryCount = useMemo(() => {
    if (!isDone) return 0;
    let count = 0;
    for (const event of events) {
      if (event.type === "output" || event.type === "error" || event.type === "status") {
        count++;
      }
    }
    return count;
  }, [isDone, events]);

  if (!isDone) {
    // While running, render directly without collapsible wrapper
    return (
      <OperationLog
        operationId={operation.id}
        events={events}
        isRunning={isRunning}
      />
    );
  }

  const isSuccess = operation.status === "completed";

  return (
    <div className="rounded-md border">
      {/* Collapsible header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-accent/50"
      >
        <span className="text-muted-foreground">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span className={`font-medium ${isSuccess ? "text-green-600" : "text-red-500"}`}>
          {isSuccess ? "\u2713" : "\u2717"}
        </span>
        <span className="font-medium text-foreground">
          {isSuccess ? "Operation completed" : "Operation failed"}
        </span>
        <span className="text-muted-foreground">
          ({logEntryCount} events)
        </span>
      </div>

      {/* Expanded: full log */}
      {expanded && (
        <div className="border-t p-2">
          <OperationLog
            operationId={operation.id}
            events={events}
            isRunning={isRunning}
          />
        </div>
      )}

      {/* Result — show only the last phase's result */}
      {resultEntries.length > 0 && (() => {
        const last = resultEntries[resultEntries.length - 1];
        return (
          <div className="border-t p-2">
            <ResultBox
              content={last.kind === "result" ? last.content : ""}
              cost={last.kind === "result" ? last.cost : undefined}
              duration={last.kind === "result" ? last.duration : undefined}
            />
          </div>
        );
      })()}
    </div>
  );
}
