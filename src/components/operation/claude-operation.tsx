"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useOperation } from "@/hooks/use-operation";
import { CollapsibleOperationLog } from "./collapsible-operation-log";
import { OperationInputs } from "./operation-inputs";
import { OperationSummary, useNow } from "./operation-summary";
import { Button } from "../shared/buttons/button";
import { Spinner } from "../shared/feedback/spinner";
import type { OperationType, OperationContext } from "@/types/operation";

/**
 * Shared component for running Claude operations.
 *
 * Handles:
 * - Operation state lifecycle (via useOperation + localStorage persistence)
 * - Status badge, Cancel button (running), Clear button (done)
 * - OperationLog rendering
 *
 * The caller provides trigger UI (buttons, forms) via `children` render prop.
 */
export function ClaudeOperation({
  storageKey,
  children,
  vertical,
  onRunningChange,
  initialOperationId,
}: {
  storageKey: string;
  children: (ctx: OperationContext) => ReactNode;
  vertical?: boolean;
  /** Called when the running state changes. Useful for coordinating multiple independent operations. */
  onRunningChange?: (running: boolean) => void;
  /** When provided, reconnect to an existing operation by ID (e.g. from Running Operations page). */
  initialOperationId?: string;
}) {
  const { operation, events, isRunning, start, cancel, reset } =
    useOperation(storageKey, initialOperationId);
  const [loading, setLoading] = useState(false);
  const now = useNow(1000);

  const handleStart = async (
    type: OperationType,
    body: Record<string, string>
  ) => {
    setLoading(true);
    try {
      await start(type, body);
    } catch (err) {
      console.error("Failed to start operation:", err);
    } finally {
      setLoading(false);
    }
  };

  const effectiveRunning = isRunning || loading;

  // Notify parent of running state changes
  const onRunningChangeRef = useRef(onRunningChange);
  onRunningChangeRef.current = onRunningChange;
  useEffect(() => {
    onRunningChangeRef.current?.(effectiveRunning);
  }, [effectiveRunning]);

  const isDone = !effectiveRunning && operation && (operation.status === "completed" || operation.status === "failed");

  const actionButtons = operation && (
    <div className="flex items-center gap-2">
      {isRunning ? (
        <Button variant="destructive-sm" onClick={cancel}>
          Cancel
        </Button>
      ) : (
        <>
          {isDone && operation.type !== "delete" && (
            <Button
              variant="outline"
              onClick={() =>
                handleStart(operation.type, {
                  workspace: operation.workspace,
                })
              }
            >
              Retry
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      )}
    </div>
  );

  const statusBlock = operation && (
    <div className="flex items-start gap-2">
      <OperationSummary operation={operation} now={now} />
      <div className="shrink-0">{actionButtons}</div>
    </div>
  );

  const childContent = children({
    start: handleStart,
    isRunning: effectiveRunning,
    hasOperation: !!operation,
    workspace: operation?.workspace,
    status: operation?.status,
  });

  const showStarting = effectiveRunning && events.length === 0;

  const startingIndicator = showStarting && (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
      <Spinner />
      Operation starting…
    </div>
  );

  const inputsBlock = operation?.inputs && Object.keys(operation.inputs).length > 0 && (
    <OperationInputs inputs={operation.inputs} />
  );

  if (vertical) {
    return (
      <div className="space-y-3">
        {childContent}
        {statusBlock}
        {inputsBlock}
        {startingIndicator}
        {operation && events.length > 0 && (
          <CollapsibleOperationLog
            operation={operation}
            isRunning={isRunning}
            events={events}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {childContent}
      {statusBlock}
      {inputsBlock}
      {startingIndicator}
      {operation && events.length > 0 && (
        <CollapsibleOperationLog
          operation={operation}
          isRunning={isRunning}
          events={events}
        />
      )}
    </div>
  );
}
