"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SplitButton } from "../shared/split-button";
import { useRunningOperations } from "@/hooks/use-running-operations";
import type { OperationType } from "@/types/operation";

export function OperationPanel({
  workspaceName,
  workspacePath,
  repositories,
}: {
  workspaceName: string;
  workspacePath: string;
  /** Repository metadata from workspace README for "Open in VS Code" dropdown. */
  repositories?: { alias: string; path: string }[];
}) {
  const router = useRouter();
  const { operations, isWorkspaceRunning } = useRunningOperations();
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
          disabled={isRunning}
          className="rounded-l-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
        <button
          onClick={() =>
            startAndNavigate("review", { workspace: workspacePath })
          }
          disabled={isRunning}
          className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        >
          Review
        </button>
        <button
          onClick={() =>
            startAndNavigate("create-pr", { workspace: workspacePath })
          }
          disabled={isRunning}
          className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
        >
          Create PR
        </button>
        <OpenVSCodeButton
          workspacePath={workspacePath}
          repositories={repositories}
        />
        <button
          onClick={() =>
            startAndNavigate("delete", { workspace: workspacePath })
          }
          disabled={isRunning}
          className="rounded-md border border-red-300 bg-transparent px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete workspace
        </button>
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
  fetch("/api/operations/open-vscode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json();
        console.error("Failed to open VS Code:", data.error);
      }
    })
    .catch((e) => {
      console.error("Failed to open VS Code:", e);
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
      <button
        onClick={handleClick}
        className="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
      >
        Open in VS Code
      </button>
    );
  }

  return (
    <SplitButton
      label="Open in VS Code"
      onClick={handleClick}
      className="rounded-l-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
      dropdownClassName="rounded-r-md border-l border-secondary-foreground/20 bg-secondary px-1.5 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
      items={repoItems}
    />
  );
}
