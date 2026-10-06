"use client";

import { useState } from "react";
import { ClaudeOperation } from "@/components/operation/claude-operation";
import { Button } from "@/components/shared/buttons/button";
import { Input } from "@/components/shared/forms/input";
import { PageHeader } from "@/components/shared/feedback/page-header";

export default function WorkspacePrunePage() {
  const [days, setDays] = useState("7");
  const [archivedOnly, setArchivedOnly] = useState(true);

  return (
    <div>
      <PageHeader
        title="Workspace Prune"
        description="Delete workspaces not modified within the specified number of days. By default only archived workspaces are deleted."
      />

      <ClaudeOperation storageKey="utility:workspace-prune" vertical>
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
              Archived workspaces only
            </label>
            <Button
              onClick={() =>
                start("workspace-prune", {
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
