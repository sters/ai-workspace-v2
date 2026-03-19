"use client";

import Link from "next/link";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { RepositoryActionButton } from "./repository-action-button";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { openInEditor, openInTerminal } from "@/lib/api";
import { buildBatchItems } from "@/lib/batch-modes";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  CodeXml,
  Terminal,
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

  // Find the running operation for this workspace to link to
  const runningOp = isRunning
    ? operations.find(
        (op) => op.status === "running" && op.workspace === workspaceName
      )
    : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SplitButton
          label={<><Play className="h-3.5 w-3.5" /> Execute</>}
          onClick={() =>
            startAndNavigate("execute", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "execute")}
          items={buildBatchItems("execute", { workspace: workspacePath }, (body) =>
            startAndNavigate("batch", body)
          )}
        />
        <Button
          variant="secondary"
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
          onClick={() =>
            startAndNavigate("review", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "review")}
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> Review
        </Button>
        <RepositoryActionButton
          label={<><GitPullRequest className="h-3.5 w-3.5" /> Create PR</>}
          onClick={() =>
            startAndNavigate("create-pr", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "create-pr")}
          repositories={repositories}
          onRepoClick={(repo) =>
            startAndNavigate("create-pr", {
              workspace: workspacePath,
              repository: repo.path,
            })
          }
        />
        <RepositoryActionButton
          label={<><CodeXml className="h-3.5 w-3.5" /> Open in editor</>}
          onClick={() => openInEditor(workspacePath)}
          repositories={repositories}
          onRepoClick={(repo) => openInEditor(`${workspacePath}/${repo.path}`)}
        />
        <RepositoryActionButton
          label={<><Terminal className="h-3.5 w-3.5" /> Open in terminal</>}
          onClick={() => openInTerminal(workspacePath)}
          repositories={repositories}
          onRepoClick={(repo) => openInTerminal(`${workspacePath}/${repo.path}`)}
        />
        <Button
          variant="destructive"
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-transparent px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
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
