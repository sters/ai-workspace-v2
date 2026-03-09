"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SplitButton } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { useRunningOperations } from "@/hooks/use-running-operations";
import type { OperationType } from "@/types/operation";

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
          label="Execute"
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
          onClick={() =>
            startAndNavigate("review", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "review")}
        >
          Review
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            startAndNavigate("create-pr", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "create-pr")}
        >
          Create PR
        </Button>
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
          onClick={() =>
            startAndNavigate("delete", { workspace: workspacePath })
          }
          disabled={isWorkspaceTypeRunning(workspaceName, "delete")}
        >
          Delete workspace
        </Button>
      </div>
      {isRunning && runningOp && (
        <p className="text-sm text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500 mr-1.5" />
          Operation running &mdash;{" "}
          <Link
            href={`/workspace/${encodeURIComponent(workspaceName)}/operations?operationId=${encodeURIComponent(runningOp.id)}`}
            className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View running operation
          </Link>
        </p>
      )}
    </div>
  );
}

function openInVSCode(targetPath: string) {
  return fetch("/api/operations/open-vscode", {
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

function OpenVSCodeButton({
  workspacePath,
  repositories,
}: {
  workspacePath: string;
  repositories?: { alias: string; path: string }[];
}) {
  const handleClick = useCallback(
    () => openInVSCode(workspacePath),
    [workspacePath]
  );

  const repoItems = (repositories ?? []).map((repo) => ({
    label: repo.alias || repo.path.split("/").pop() || repo.path,
    onClick: () => openInVSCode(`${workspacePath}/${repo.path}`),
  }));

  if (repoItems.length === 0) {
    return (
      <Button variant="secondary" onClick={handleClick}>
        Open in editor
      </Button>
    );
  }

  return (
    <SplitButton
      label="Open in editor"
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

  if (repoItems.length === 0) {
    return (
      <Button variant="secondary" onClick={handleClick}>
        Open in terminal
      </Button>
    );
  }

  return (
    <SplitButton
      label="Open in terminal"
      onClick={handleClick}
      variant="secondary"
      items={repoItems}
    />
  );
}
