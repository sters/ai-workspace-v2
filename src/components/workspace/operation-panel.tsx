"use client";

import { useEffect, useRef } from "react";
import { ClaudeOperation } from "../operation/claude-operation";
import { SplitButton } from "../shared/split-button";
import type { OperationContext } from "@/types/operation";
import type { OperationType } from "@/types/operation";

export function OperationPanel({
  workspacePath,
  autoAction,
  autoActionExtra,
  onAutoActionConsumed,
}: {
  workspacePath: string;
  /** When set, auto-trigger this operation on mount (once). */
  autoAction?: OperationType;
  /** Extra params for auto-action (e.g. batch mode/startWith from URL). */
  autoActionExtra?: Record<string, string>;
  /** Called after auto-action has been triggered, so the parent can clear the param. */
  onAutoActionConsumed?: () => void;
}) {
  const autoActionFiredRef = useRef(false);

  return (
    <ClaudeOperation storageKey={`workspace:${workspacePath}`} workspace={workspacePath}>
      {({ start, isRunning, hasOperation }) => (
        <AutoActionWrapper
          autoAction={autoAction}
          autoActionExtra={autoActionExtra}
          firedRef={autoActionFiredRef}
          start={start}
          isRunning={isRunning}
          hasOperation={hasOperation}
          workspacePath={workspacePath}
          onConsumed={onAutoActionConsumed}
        >
          <SplitButton
            label="Execute"
            onClick={() => start("execute", { workspace: workspacePath })}
            disabled={isRunning}
            className="rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            items={[
              {
                label: "Execute \u2192 Review",
                onClick: () =>
                  start("batch", {
                    startWith: "execute",
                    mode: "execute-review",
                    workspace: workspacePath,
                  }),
              },
              {
                label: "Execute \u2192 PR",
                onClick: () =>
                  start("batch", {
                    startWith: "execute",
                    mode: "execute-pr",
                    workspace: workspacePath,
                  }),
              },
              {
                label: "Execute \u2192 Review \u2192 PR (gated)",
                onClick: () =>
                  start("batch", {
                    startWith: "execute",
                    mode: "execute-review-pr-gated",
                    workspace: workspacePath,
                  }),
              },
              {
                label: "Execute \u2192 Review \u2192 PR",
                onClick: () =>
                  start("batch", {
                    startWith: "execute",
                    mode: "execute-review-pr",
                    workspace: workspacePath,
                  }),
              },
            ]}
          />
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
  autoActionExtra,
  firedRef,
  start,
  isRunning,
  hasOperation,
  workspacePath,
  onConsumed,
  children,
}: {
  autoAction?: OperationType;
  autoActionExtra?: Record<string, string>;
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
    start(autoAction, { workspace: workspacePath, ...autoActionExtra });
    onConsumed?.();
  }, [autoAction, autoActionExtra, firedRef, start, isRunning, hasOperation, workspacePath, onConsumed]);

  return <>{children}</>;
}
