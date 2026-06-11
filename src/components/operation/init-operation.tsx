"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ClaudeOperation } from "./claude-operation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

/** Shared storageKey for init operations. Both /new and /suggestions use this. */
export const INIT_STORAGE_KEY = "init";

/** Navigate to workspace operations page once workspace name is determined. */
function AutoNavigateToWorkspace({
  workspace,
  reset,
}: {
  workspace: string;
  reset: () => void;
}) {
  const router = useRouter();
  const navigated = useRef(false);
  useEffect(() => {
    if (navigated.current) return;
    navigated.current = true;
    // Release the in-memory operation state AND its localStorage entry so
    // returning to /new doesn't restore it and auto-navigate again (which
    // also caused the SSR/client hydration mismatch). Calling reset() instead
    // of removeItem() prevents useOperation's persist effect from writing the
    // still-non-null operation straight back into localStorage.
    reset();
    router.push(`/workspace/${encodeURIComponent(workspace)}/operations`);
  }, [router, workspace, reset]);
  return null;
}

/**
 * SplitButton for starting init operations (init / batch / autonomous).
 * Shared between /new and /suggestions pages.
 */
export function InitSplitButton({
  description,
  interactionLevel,
  start,
  disabled,
}: {
  description: string;
  interactionLevel: InteractionLevel;
  start: (type: OperationType, body: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const trimmed = description.trim();
  return (
    <SplitButton
      label="Start autonomous"
      onClick={() => {
        if (!trimmed) return;
        start("autonomous", {
          description: trimmed,
          interactionLevel,
          startWith: "init",
        });
      }}
      disabled={disabled || !trimmed}
      items={[
        {
          label: "Init only",
          onClick: () => {
            if (!trimmed) return;
            start("init", { description: trimmed, interactionLevel });
          },
        },
      ]}
    />
  );
}

/**
 * Wraps ClaudeOperation with the shared init storageKey.
 * Provides start function and auto-navigates on workspace creation.
 * Children receive `start` and `started` (whether an operation is active).
 */
export function InitOperation({
  children,
}: {
  children: (ctx: {
    start: (type: OperationType, body: Record<string, string>) => void;
    started: boolean;
  }) => React.ReactNode;
}) {
  return (
    <ClaudeOperation storageKey={INIT_STORAGE_KEY}>
      {({ start, reset, isRunning, workspace, status }) => {
        const started = isRunning || status === "completed" || status === "failed";
        return (
          <>
            {children({ start, started })}
            {workspace && (
              <AutoNavigateToWorkspace workspace={workspace} reset={reset} />
            )}
          </>
        );
      }}
    </ClaudeOperation>
  );
}
