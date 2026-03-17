"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { useRunningOperations } from "@/hooks/use-running-operations";
import type { OperationType } from "@/types/operation";
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
  const router = useRouter();
  const { operations, isWorkspaceRunning, isWorkspaceTypeRunning } = useRunningOperations();
  const isRunning = isWorkspaceRunning(workspaceName);

  // Find the running operation for this workspace to link to
  const runningOp = isRunning
    ? operations.find(
        (op) => op.status === "running" && op.workspace === workspaceName
      )
    : undefined;

  const startAndNavigate = useCallback(
    async (type: OperationType, body: Record<string, string>) => {
      const res = await fetch(`/api/operations/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("Failed to start operation:", await res.text());
        return;
      }
      const op = await res.json();
      router.push(
        `/workspace/${encodeURIComponent(workspaceName)}/operations?operationId=${encodeURIComponent(op.id)}`
      );
    },
    [router, workspaceName]
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SplitButton
          label={<><Play className="h-3.5 w-3.5" /> Execute</>}
          onClick={() =>
            startAndNavigate("execute", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "execute")}
          items={[
            {
              label: "Execute \u2192 Review",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "execute",
                  mode: "execute-review",
                  workspace: workspacePath,
                }),
            },
            {
              label: "Execute \u2192 PR",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "execute",
                  mode: "execute-pr",
                  workspace: workspacePath,
                }),
            },
            {
              label: "Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "execute",
                  mode: "execute-review-pr-gated",
                  workspace: workspacePath,
                }),
            },
            {
              label: "Execute \u2192 Review \u2192 PR",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "execute",
                  mode: "execute-review-pr",
                  workspace: workspacePath,
                }),
            },
          ]}
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
        <CreatePRButton
          workspacePath={workspacePath}
          repositories={repositories}
          disabled={isWorkspaceTypeRunning(workspaceName, "create-pr")}
          onStartAndNavigate={startAndNavigate}
        />
        <OpenVSCodeButton
          workspacePath={workspacePath}
          repositories={repositories}
        />
        <OpenTerminalButton
          workspacePath={workspacePath}
          repositories={repositories}
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

function openInEditor(targetPath: string) {
  return fetch("/api/operations/open-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open editor:", data.error);
    }
  });
}

function openInTerminal(targetPath: string) {
  return fetch("/api/operations/open-terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open terminal:", data.error);
    }
  });
}

function CreatePRButton({
  workspacePath,
  repositories,
  disabled,
  onStartAndNavigate,
}: {
  workspacePath: string;
  repositories?: { alias: string; path: string }[];
  disabled: boolean;
  onStartAndNavigate: (type: OperationType, body: Record<string, string>) => Promise<void>;
}) {
  const handleClick = useCallback(
    () => onStartAndNavigate("create-pr", { workspace: workspacePath }),
    [onStartAndNavigate, workspacePath]
  );

  const repoItems = (repositories ?? []).map((repo) => ({
    label: repo.alias || repo.path.split("/").pop() || repo.path,
    onClick: () =>
      onStartAndNavigate("create-pr", {
        workspace: workspacePath,
        repository: repo.path,
      }),
  }));

  const labelNode = <><GitPullRequest className="h-3.5 w-3.5" /> Create PR</>;

  if (repoItems.length === 0) {
    return (
      <Button
        variant="secondary"
        className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        onClick={handleClick}
        disabled={disabled}
      >
        {labelNode}
      </Button>
    );
  }

  return (
    <SplitButton
      label={labelNode}
      onClick={handleClick}
      variant="secondary"
      disabled={disabled}
      items={repoItems}
    />
  );
}

function OpenVSCodeButton({
  workspacePath,
  repositories,
}: {
  workspacePath: string;
  repositories?: { alias: string; path: string }[];
}) {
  const handleClick = useCallback(
    () => openInEditor(workspacePath),
    [workspacePath]
  );

  const repoItems = (repositories ?? []).map((repo) => ({
    label: repo.alias || repo.path.split("/").pop() || repo.path,
    onClick: () => openInEditor(`${workspacePath}/${repo.path}`),
  }));

  const labelNode = <><CodeXml className="h-3.5 w-3.5" /> Open in editor</>;

  if (repoItems.length === 0) {
    return (
      <Button
        variant="secondary"
        className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        onClick={handleClick}
      >
        {labelNode}
      </Button>
    );
  }

  return (
    <SplitButton
      label={labelNode}
      onClick={handleClick}
      variant="secondary"
      items={repoItems}
    />
  );
}

function OpenTerminalButton({
  workspacePath,
  repositories,
}: {
  workspacePath: string;
  repositories?: { alias: string; path: string }[];
}) {
  const handleClick = useCallback(
    () => openInTerminal(workspacePath),
    [workspacePath]
  );

  const repoItems = (repositories ?? []).map((repo) => ({
    label: repo.alias || repo.path.split("/").pop() || repo.path,
    onClick: () => openInTerminal(`${workspacePath}/${repo.path}`),
  }));

  const labelNode = <><Terminal className="h-3.5 w-3.5" /> Open in terminal</>;

  if (repoItems.length === 0) {
    return (
      <Button
        variant="secondary"
        className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        onClick={handleClick}
      >
        {labelNode}
      </Button>
    );
  }

  return (
    <SplitButton
      label={labelNode}
      onClick={handleClick}
      variant="secondary"
      items={repoItems}
    />
  );
}
