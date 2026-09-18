"use client";

import Link from "next/link";
import { ClaudeOperation } from "./claude-operation";
import { SplitButton } from "@/components/shared/buttons/split-button";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

/** Where the run went, once it has named a workspace. */
function WorkspaceLink({ workspace }: { workspace: string }) {
  return (
    <p className="text-sm">
      Working in{" "}
      <Link
        href={`/workspace/${encodeURIComponent(workspace)}/operations`}
        className="font-mono underline"
      >
        {workspace}
      </Link>
    </p>
  );
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
 * Wraps ClaudeOperation for the init flows: the run stays on this page, with a
 * link out once it has named a workspace. Children receive `start` and
 * `started` (whether an operation is active).
 *
 * No `storageKey`, so nothing about the run is remembered here. The entry
 * existed to carry the jump to the workspace across a reload; with the jump
 * gone, a running init is followed from the sidebar or Running Operations, and
 * coming back to the form finds a form.
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
    <ClaudeOperation>
      {({ start, isRunning, workspace, status }) => {
        const started = isRunning || status === "completed" || status === "failed";
        return (
          <>
            {children({ start, started })}
            {workspace && <WorkspaceLink workspace={workspace} />}
          </>
        );
      }}
    </ClaudeOperation>
  );
}
