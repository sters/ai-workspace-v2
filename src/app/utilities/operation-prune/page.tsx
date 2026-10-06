"use client";

import { useState } from "react";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function OperationPrunePage() {
  const [days, setDays] = useState("7");
  const [archivedOnly, setArchivedOnly] = useState(true);

  return (
    <div>
      <PageHeader
        title="Operation Log Prune"
        description="Delete operation logs older than the specified number of days. By default only logs of archived workspaces are deleted."
      />

      <ClaudeOperation storageKey="utility:operation-prune" vertical>
        {({ start, isRunning }) => (
          <div className="flex items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Days</label>
              <Input
                type="number"
                placeholder="7"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                disabled={isRunning}
                className="w-32"
              />
            </div>
            <label className="flex items-center gap-2 py-1.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={archivedOnly}
                onChange={(e) => setArchivedOnly(e.target.checked)}
                disabled={isRunning}
              />
              Logs of archived workspaces only
            </label>
            <Button
              onClick={() =>
                start("operation-prune", {
                  days: String(Number(days) || 7),
                  archivedOnly: String(archivedOnly),
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
