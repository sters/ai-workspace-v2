"use client";

import { useState } from "react";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function OperationPrunePage() {
  const [days, setDays] = useState("7");

  return (
    <div>
      <PageHeader
        title="Operation Log Prune"
        description="Delete operation logs older than the specified number of days."
      />

      <ClaudeOperation storageKey="utility:operation-prune" vertical>
        {({ start, isRunning }) => (
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Days</label>
              <input
                type="number"
                placeholder="7"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                disabled={isRunning}
                className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              />
            </div>
            <Button
              onClick={() =>
                start("operation-prune", {
                  days: String(Number(days) || 7),
                })
              }
              disabled={isRunning}
            >
              Run
            </Button>
          </div>
        )}
      </ClaudeOperation>
    </div>
  );
}
