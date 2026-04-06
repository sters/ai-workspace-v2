"use client";

import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";

const PRUNE_STORAGE_KEY = "prune-suggestions";

export default function PrunePage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Check each suggestion against its target repository to determine if it
        has already been addressed. Resolved suggestions will be dismissed.
      </p>

      <ClaudeOperation storageKey={PRUNE_STORAGE_KEY}>
        {({ start, isRunning, hasOperation }) => (
          <>
            {(!hasOperation || !isRunning) && (
              <Button
                onClick={() => start("prune-suggestions", {})}
                disabled={isRunning}
              >
                Start Prune
              </Button>
            )}
          </>
        )}
      </ClaudeOperation>
    </div>
  );
}
