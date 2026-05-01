"use client";

import { useState } from "react";
import Link from "next/link";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { RepositoryActionButton } from "./repository-action-button";
import { DropdownMenu, type DropdownItem } from "../shared/menus/dropdown-menu";
import { showToast } from "../shared/feedback/toast";
import { InteractionLevelSelector } from "../shared/forms/interaction-level-selector";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { useOpeners } from "@/hooks/use-openers";
import { openWith } from "@/lib/api";
import { buildBatchItems, buildAutonomousItems } from "@/lib/batch-modes";
import type { InteractionLevel } from "@/types/prompts";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  FolderOpen,
  Trash2,
} from "lucide-react";

export function OperationPanel({
  workspaceName,
  workspacePath,
  repositories,
}: {
  workspaceName: string;
  workspacePath: string;
  /** Repository metadata from workspace README for "Open in editor" dropdown. */
  repositories?: { alias: string; path: string }[];
}) {
  const { operations, isWorkspaceRunning, isWorkspaceTypeRunning } = useRunningOperations();
  const isRunning = isWorkspaceRunning(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");
  const { openers } = useOpeners();

  // Build "Open in..." menu structure: opener × (Root + each repository).
  const pathTargets = [
    { label: "Root", subPath: undefined as string | undefined },
    ...(repositories ?? []).map((r) => ({ label: r.alias, subPath: r.path })),
  ];
  const openerMenuItems: DropdownItem[] = openers.map((opener) => ({
    kind: "group" as const,
    label: opener.name,
    items: pathTargets.map((target) => ({
      label: target.label,
      onSelect: async () => {
        try {
          await openWith(workspacePath, opener.name, target.subPath);
        } catch (err) {
          showToast(
            err instanceof Error
              ? err.message
              : `Failed to launch ${opener.name}`,
            "error",
          );
        }
      },
    })),
  }));

  /** Build body with workspace path and current interaction level. */
  const body = (extra?: Record<string, string>) => ({
    workspace: workspacePath,
    interactionLevel,
    ...extra,
  });

  // Find the running operation for this workspace to link to
  const runningOp = isRunning
    ? operations.find(
        (op) => op.status === "running" && op.workspace === workspaceName
      )
    : undefined;

  return (
    <div className="space-y-3">
      {/* Interaction Level selector */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">Interaction:</span>
        <InteractionLevelSelector
          value={interactionLevel}
          onChange={setInteractionLevel}
          disabled={false}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SplitButton
          label={<><Play className="h-3.5 w-3.5" /> Execute</>}
          onClick={() => startAndNavigate("execute", body())}
          disabled={isWorkspaceTypeRunning(workspaceName, "execute")}
          items={[
            ...buildBatchItems("execute", body(), (b) =>
              startAndNavigate("batch", b)
            ),
            ...buildAutonomousItems("execute", body(), (b) =>
              startAndNavigate("autonomous", b)
            ),
          ]}
        />
        <Button
          variant="secondary"
          onClick={() => startAndNavigate("review", body())}
          disabled={isWorkspaceTypeRunning(workspaceName, "review")}
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> Review
        </Button>
        <RepositoryActionButton
          label={<><GitPullRequest className="h-3.5 w-3.5" /> Create PR</>}
          onClick={() => startAndNavigate("create-pr", body())}
          disabled={isWorkspaceTypeRunning(workspaceName, "create-pr")}
          repositories={repositories}
          onRepoClick={(repo) =>
            startAndNavigate("create-pr", body({ repository: repo.path }))
          }
        />
        {openerMenuItems.length > 0 && (
          <DropdownMenu
            ariaLabel="Open in..."
            trigger={
              <>
                <FolderOpen className="h-3.5 w-3.5" /> Open in...
              </>
            }
            items={openerMenuItems}
          />
        )}
        <Button
          variant="destructive"
          className="ml-auto"
          onClick={() =>
            startAndNavigate("delete", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "delete")}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete workspace
        </Button>
      </div>
      {isRunning && runningOp && (
        <p className="text-sm text-muted-foreground">
          <span className={`inline-block h-2 w-2 animate-pulse rounded-full mr-1.5 ${runningOp.hasPendingAsk ? "bg-orange-500" : "bg-blue-500"}`} />
          {runningOp.hasPendingAsk ? "Waiting for input" : "Operation running"} &mdash;{" "}
          <Link
            href={`/workspace/${encodeURIComponent(workspaceName)}/operations?operationId=${encodeURIComponent(runningOp.id)}`}
            className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {runningOp.hasPendingAsk ? "Answer now" : "View running operation"}
          </Link>
        </p>
      )}
    </div>
  );
}
