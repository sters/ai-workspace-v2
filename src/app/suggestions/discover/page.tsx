"use client";

import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";

const DISCOVERY_STORAGE_KEY = "discovery";

export default function DiscoverPage() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Analyze recent completed operations to discover new workspace candidates.
        Results will appear in the List tab.
      </p>

      <ClaudeOperation storageKey={DISCOVERY_STORAGE_KEY}>
        {({ start, isRunning, hasOperation }) => (
          <>
            {(!hasOperation || !isRunning) && (
              <Button
                onClick={() => start("discovery", {})}
                disabled={isRunning}
              >
                Start Discovery
              </Button>
            )}
          </>
        )}
      </ClaudeOperation>
    </div>
  );
}
