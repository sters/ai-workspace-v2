"use client";

import { useEffect, useRef } from "react";
import { ClaudeOperation, type OperationContext } from "../operation/claude-operation";
import type { OperationType } from "@/types/operation";

export function OperationPanel({
  workspacePath,
  autoAction,
  onAutoActionConsumed,
}: {
  workspacePath: string;
  /** When set, auto-trigger this operation on mount (once). */
  autoAction?: OperationType;
  /** Called after auto-action has been triggered, so the parent can clear the param. */
  onAutoActionConsumed?: () => void;
}) {
  const autoActionFiredRef = useRef(false);

  return (
    <ClaudeOperation storageKey={`workspace:${workspacePath}`} workspace={workspacePath}>
      {({ start, isRunning, hasOperation }) => (
        <AutoActionWrapper
          autoAction={autoAction}
          firedRef={autoActionFiredRef}
          start={start}
          isRunning={isRunning}
          hasOperation={hasOperation}
          workspacePath={workspacePath}
          onConsumed={onAutoActionConsumed}
        >
          <button
            onClick={() => start("execute", { workspace: workspacePath })}
            disabled={isRunning}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Execute
          </button>
          <button
            onClick={() => start("review", { workspace: workspacePath })}
            disabled={isRunning}
            className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            Review
          </button>
          <button
            onClick={() => start("create-pr", { workspace: workspacePath })}
            disabled={isRunning}
            className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            Create PR
          </button>
          <button
            onClick={() => start("delete", { workspace: workspacePath })}
            disabled={isRunning}
            className="rounded-md border border-red-300 bg-transparent px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete workspace
          </button>
        </AutoActionWrapper>
      )}
    </ClaudeOperation>
  );
}

/**
 * Helper component that auto-triggers an action via useEffect.
 * Must be a separate component so the effect can access the `start` function
 * from the ClaudeOperation render prop.
 */
function AutoActionWrapper({
  autoAction,
  firedRef,
  start,
  isRunning,
  hasOperation,
  workspacePath,
  onConsumed,
  children,
}: {
  autoAction?: OperationType;
  firedRef: React.MutableRefObject<boolean>;
  start: OperationContext["start"];
  isRunning: boolean;
  hasOperation: boolean;
  workspacePath: string;
  onConsumed?: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!autoAction || firedRef.current || isRunning || hasOperation) return;
    firedRef.current = true;
    start(autoAction, { workspace: workspacePath });
    onConsumed?.();
  }, [autoAction, firedRef, start, isRunning, hasOperation, workspacePath, onConsumed]);

  return <>{children}</>;
}
