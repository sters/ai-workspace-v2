"use client";

import type { TodoFile } from "@/types/workspace";
import { Card } from "../shared/containers/card";
import { StatusText } from "../shared/feedback/status-text";
import { UpdateForm } from "./update-form";
import { RepoTodoCard } from "./repo-todo-card";
import { useRunningOperations } from "@/hooks/use-running-operations";
import { useStartAndNavigate } from "@/hooks/use-start-and-navigate";
import { buildBatchItems, buildAutonomousItems } from "@/lib/batch-modes";

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
  const { isWorkspaceTypeRunning, isRepoTypeRunning } = useRunningOperations();
  const isAnyRunning = isWorkspaceTypeRunning(workspaceName, "update-todo");
  const startAndNavigate = useStartAndNavigate(workspaceName);

  if (todos.length === 0) {
    return <StatusText>No TODO files found.</StatusText>;
  }

  return (
    <div className="space-y-6">
      {/* Workspace-wide update form */}
      <Card variant="dashed">
        <p className="mb-2 text-sm font-medium">Update workspace TODOs</p>
        <UpdateForm
          label="Update"
          placeholder="Describe TODO changes to apply across all repositories..."
          disabled={isAnyRunning}
          onSubmit={(instruction, interactionLevel) => {
            startAndNavigate("update-todo", {
              workspace: workspacePath,
              instruction,
              interactionLevel,
            });
          }}
          batchItems={(instruction, interactionLevel) => {
            const base = {
              workspace: workspacePath,
              interactionLevel,
              ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            };
            return [
              ...buildBatchItems("update-todo", base, (body) => startAndNavigate("batch", body)),
              ...buildAutonomousItems("update-todo", base, (body) => startAndNavigate("autonomous", body)),
            ];
          }}
        />
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
