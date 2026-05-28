"use client";

import { Card } from "../shared/containers/card";
import { UpdateForm } from "./update-form";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";

export function ReadmeUpdater({
  workspaceName,
  workspacePath,
}: {
  workspaceName: string;
  workspacePath: string;
}) {
  const { isWorkspaceRunning, isWorkspaceTypeRunning } = useRunningOperations();
  const isUpdateReadmeRunning = isWorkspaceTypeRunning(workspaceName, "update-readme");
  const canInterject = !isUpdateReadmeRunning && isWorkspaceRunning(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);

  return (
    <Card variant="dashed">
      <p className="mb-2 text-sm font-medium">Update README</p>
      {canInterject && (
        <p className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-900 dark:text-amber-200">
          An operation is currently running. Submitting will interrupt it, update README, then restart autonomous from execute.
        </p>
      )}
      <UpdateForm
        label={canInterject ? "Interject + restart" : "Update README"}
        placeholder="Describe README changes (e.g., 'add a Risks section', 'tighten Objective')..."
        disabled={isUpdateReadmeRunning}
        onSubmit={(instruction, interactionLevel) => {
          startAndNavigate("update-readme", {
            workspace: workspacePath,
            instruction,
            interactionLevel,
            ...(canInterject && { interject: "true" }),
          });
        }}
      />
    </Card>
  );
}
