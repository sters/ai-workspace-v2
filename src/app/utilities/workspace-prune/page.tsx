"use client";

import { useState } from "react";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";

export default function WorkspacePrunePage() {
  const [days, setDays] = useState("7");

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Workspace Prune</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Delete workspaces not modified within the specified number of days.
      </p>

      <ClaudeOperation storageKey="utility:workspace-prune" vertical>
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
                start("workspace-prune", {
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
