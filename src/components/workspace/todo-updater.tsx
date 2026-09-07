"use client";

import type { TodoFile } from "@/types/workspace";
import { Bot } from "lucide-react";
import { Card } from "../shared/containers/card";
import { Button } from "../shared/buttons/button";
import { StatusText } from "../shared/feedback/status-text";
import { UpdateForm } from "./update-form";
import { RepoTodoCard } from "./repo-todo-card";
import { SolveBaseConflictsButton } from "./solve-base-conflicts-button";
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

/**
 * The worktree directory name, which is also the repo's `TODO-<name>.md` name.
 * For a parallel worktree the README path keeps the `___alias` suffix, so the
 * last segment matches what `setupRepository` wrote.
 */
function repoNameOf(repo: { alias: string; path: string }): string {
  return repo.path.split("/").pop() ?? repo.alias;
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

  // Declared in the README (so `Ensure TODOs` will plan it) but with no TODO
  // file on disk yet. Rendering the tab from `todos` alone dropped these
  // repositories silently, which is what a repo added after init looks like.
  const unplanned = (repositories ?? []).filter((repo) => {
    const name = repoNameOf(repo);
    return !todos.some((t) => t.repoName === name || t.repoName === repo.alias);
  });

  if (todos.length === 0 && unplanned.length === 0) {
    return <StatusText>No TODO files found.</StatusText>;
  }

  // The merge writes to every worktree and pushes, so it waits for whatever else
  // is running on the workspace — including the operation an interject would
  // interrupt, since this one is not part of that restart.
  const solveConflicts = (
    <SolveBaseConflictsButton
      workspacePath={workspacePath}
      disabled={isWorkspaceRunning(workspaceName)}
      onStart={startAndNavigate}
    />
  );

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
      {todos.length > 0 && (
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
              extraActions={solveConflicts}
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
              extraActions={solveConflicts}
            />
          )}
        </Card>
      )}

      {/* Per-repo cards */}
      {todos.map((todo) => (
        <RepoTodoCard
          key={todo.filename}
          todo={todo}
          workspacePath={workspacePath}
          disabled={isRepoTypeRunning(workspaceName, "update-todo", todo.repoName)}
          workspaceBusy={isWorkspaceRunning(workspaceName)}
          repoPath={findRepoPath(todo.repoName, repositories ?? [])}
          onStartAndNavigate={startAndNavigate}
        />
      ))}

      {/* Declared repositories with nothing planned for them yet */}
      {unplanned.map((repo) => {
        const repoName = repoNameOf(repo);
        return (
          <Card key={repo.path} variant="dashed">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">{repoName}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  No TODO file. Planning it also discovers this repository&apos;s
                  lint / test / build commands, then the run implements and reviews it.
                </p>
              </div>
              <Button
                disabled={isWorkspaceRunning(workspaceName)}
                onClick={() =>
                  startAndNavigate("autonomous", {
                    workspace: workspacePath,
                    // `execute` is what reaches the Ensure repositories +
                    // Ensure TODOs salvage phases; `update-todo` would ask an
                    // updater to write the plan without the planning phases.
                    startWith: "execute",
                    repo: repoName,
                  })
                }
              >
                <Bot className="h-3.5 w-3.5" />
                Plan TODOs
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
