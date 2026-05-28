"use client";

import type { TodoFile } from "@/types/workspace";
import { Card } from "../shared/containers/card";
import { StatusText } from "../shared/feedback/status-text";
import { UpdateForm } from "./update-form";
import { RepoTodoCard } from "./repo-todo-card";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";

function findRepoPath(
  repoName: string,
  repositories: { alias: string; path: string }[],
): string | undefined {
  for (const repo of repositories) {
    if (repo.alias === repoName) return repo.path;
    const lastSegment = repo.path.split("/").pop();
    if (lastSegment === repoName) return repo.path;
  }
  return undefined;
}

export function TodoUpdater({
  todos,
  workspacePath,
  workspaceName,
  repositories,
}: {
  todos: TodoFile[];
  workspacePath: string;
  workspaceName: string;
  repositories?: { alias: string; path: string }[];
}) {
  const { isWorkspaceRunning, isWorkspaceTypeRunning, isRepoTypeRunning } = useRunningOperations();
  const isUpdateTodoRunning = isWorkspaceTypeRunning(workspaceName, "update-todo");
  const canInterject = !isUpdateTodoRunning && isWorkspaceRunning(workspaceName);
  const startAndNavigate = useStartAndNavigate(workspaceName);

  if (todos.length === 0) {
    return <StatusText>No TODO files found.</StatusText>;
  }

  const interjectSubmit = (instruction: string, interactionLevel: string) => {
    startAndNavigate("update-todo", {
      workspace: workspacePath,
      instruction,
      interactionLevel,
      interject: "true",
    });
  };

  return (
    <div className="space-y-6">
      {/* Workspace-wide update form */}
      <Card variant="dashed">
        <p className="mb-2 text-sm font-medium">Update workspace TODOs</p>
        {canInterject && (
          <p className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-900 dark:text-amber-200">
            An operation is currently running. Submitting will interrupt it, update TODOs, then restart autonomous from execute.
          </p>
        )}
        {canInterject ? (
          <UpdateForm
            label="Interject + restart"
            placeholder="Describe TODO changes to apply across all repositories..."
            disabled={false}
            onSubmit={interjectSubmit}
          />
        ) : (
          <UpdateForm
            label="Start autonomous"
            placeholder="Describe TODO changes to apply across all repositories..."
            disabled={isUpdateTodoRunning}
            onSubmit={(instruction, interactionLevel) => {
              startAndNavigate("autonomous", {
                workspace: workspacePath,
                instruction,
                interactionLevel,
                startWith: "update-todo",
              });
            }}
            batchItems={(instruction, interactionLevel) => [
              {
                label: "Update TODOs only",
                onClick: () =>
                  startAndNavigate("update-todo", {
                    workspace: workspacePath,
                    instruction: instruction.trim(),
                    interactionLevel,
                  }),
              },
            ]}
          />
        )}
      </Card>

      {/* Per-repo cards */}
      {todos.map((todo) => (
        <RepoTodoCard
          key={todo.filename}
          todo={todo}
          workspacePath={workspacePath}
          disabled={isRepoTypeRunning(workspaceName, "update-todo", todo.repoName)}
          repoPath={findRepoPath(todo.repoName, repositories ?? [])}
          onStartAndNavigate={startAndNavigate}
        />
      ))}
    </div>
  );
}
