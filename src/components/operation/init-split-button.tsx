"use client";

import { SplitButton } from "@/components/shared/buttons/split-button";
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
  start,
  disabled,
}: {
  description: string;
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
          startWith: "init",
        });
      }}
      disabled={disabled || !trimmed}
      items={[
        {
          label: "Init only",
          onClick: () => {
            if (!trimmed) return;
            return start("init", { description: trimmed });
          },
        },
      ]}
    />
  );
}
