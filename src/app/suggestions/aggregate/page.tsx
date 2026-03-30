"use client";

import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";

const AGGREGATE_STORAGE_KEY = "aggregate-suggestions";

export default function AggregatePage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Analyze all active suggestions and merge similar ones into consolidated
        entries. Results will appear in the List tab.
      </p>

      <ClaudeOperation storageKey={AGGREGATE_STORAGE_KEY}>
        {({ start, isRunning, hasOperation }) => (
          <>
            {(!hasOperation || !isRunning) && (
              <Button
                onClick={() => start("aggregate-suggestions", {})}
                disabled={isRunning}
              >
                Start Aggregation
              </Button>
            )}
          </>
        )}
      </ClaudeOperation>
    </div>
  );
}
