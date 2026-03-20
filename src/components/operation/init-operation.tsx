"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClaudeOperation } from "./claude-operation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import { buildBatchItems, buildAutonomousItems } from "@/lib/batch-modes";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

/** Shared storageKey for init operations. Both /new and /suggestions use this. */
export const INIT_STORAGE_KEY = "init";

/** Navigate to workspace operations page once workspace name is determined. */
function AutoNavigateToWorkspace({ workspace }: { workspace: string }) {
  const router = useRouter();
  useEffect(() => {
    localStorage.removeItem(`aiw-op:${INIT_STORAGE_KEY}`);
    router.push(`/workspace/${encodeURIComponent(workspace)}/operations`);
  }, [router, workspace]);
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
      label="Initialize"
      onClick={() => {
        if (!trimmed) return;
        start("init", { description: trimmed, interactionLevel });
      }}
      disabled={disabled || !trimmed}
      items={[
        ...buildBatchItems(
          "init",
          { description: trimmed, interactionLevel },
          (body) => {
            if (!trimmed) return;
            start("batch", body);
          },
        ),
        ...buildAutonomousItems(
          "init",
          { description: trimmed, interactionLevel },
          (body) => {
            if (!trimmed) return;
            start("autonomous", body);
          },
        ),
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
      {({ start, isRunning, workspace, status }) => {
        const started = isRunning || status === "completed" || status === "failed";
        return (
          <>
            {children({ start, started })}
            {workspace && <AutoNavigateToWorkspace workspace={workspace} />}
          </>
        );
      }}
    </ClaudeOperation>
  );
}
