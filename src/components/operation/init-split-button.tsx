"use client";

import { SplitButton } from "@/components/shared/buttons/split-button";
import type { InteractionLevel } from "@/types/prompts";
import type { OperationType } from "@/types/operation";

/**
 * SplitButton for starting init operations (init / batch / autonomous).
 * Shared between /new and /suggestions pages.
 *
 * `start` may return a Promise, which is what keeps the button disabled for the
 * length of the POST — the callers no longer disable their forms around a run.
 */
export function InitSplitButton({
  description,
  interactionLevel,
  start,
  disabled,
}: {
  description: string;
  interactionLevel: InteractionLevel;
  start: (type: OperationType, body: Record<string, string>) => void | Promise<unknown>;
  disabled?: boolean;
}) {
  const trimmed = description.trim();
  return (
    <SplitButton
      label="Start autonomous"
      onClick={() => {
        if (!trimmed) return;
        return start("autonomous", {
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
            return start("init", { description: trimmed, interactionLevel });
          },
        },
      ]}
    />
  );
}
