"use client";

import type { TodoFile } from "@/types/workspace";
import type { OperationType } from "@/types/operation";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { UpdateForm } from "./update-form";
import { Card } from "../shared/containers/card";
import { ProgressBar } from "../shared/feedback/progress-bar";
import { Button } from "../shared/buttons/button";
import { openInEditor, openInTerminal } from "@/lib/api-actions";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  CodeXml,
  Terminal,
} from "lucide-react";

export function RepoTodoCard({
  todo,
  workspacePath,
  disabled,
  repoPath,
  onStartAndNavigate,
}: {
  todo: TodoFile;
  workspacePath: string;
  disabled: boolean;
  /** Full repository path (e.g. "github.com/org/repo") for per-repo operations. */
  repoPath: string | undefined;
  onStartAndNavigate: (type: OperationType, body: Record<string, string>) => void;
}) {
  const repoFullPath = repoPath
    ? `${workspacePath}/${repoPath}`
    : undefined;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{todo.repoName}</h3>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost-toggle"
              className="h-6 w-6 p-0"
              disabled={disabled}
              title="Execute"
              onClick={() =>
                onStartAndNavigate("execute", {
                  workspace: workspacePath,
                  ...(repoPath ? { repository: repoPath } : {}),
                })
              }
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost-toggle"
              className="h-6 w-6 p-0"
              disabled={disabled}
              title="Review"
              onClick={() =>
                onStartAndNavigate("review", {
                  workspace: workspacePath,
                  ...(repoPath ? { repository: repoPath } : {}),
                })
              }
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost-toggle"
              className="h-6 w-6 p-0"
              disabled={disabled}
              title="Create PR"
              onClick={() =>
                onStartAndNavigate("create-pr", {
                  workspace: workspacePath,
                  ...(repoPath ? { repository: repoPath } : {}),
                })
              }
            >
              <GitPullRequest className="h-3.5 w-3.5" />
            </Button>
            {repoFullPath && (
              <>
                <Button
                  variant="ghost-toggle"
                  className="h-6 w-6 p-0"
                  title="Open in editor"
                  onClick={() => openInEditor(repoFullPath)}
                >
                  <CodeXml className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost-toggle"
                  className="h-6 w-6 p-0"
                  title="Open in terminal"
                  onClick={() => openInTerminal(repoFullPath)}
                >
                  <Terminal className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {todo.completed}/{todo.total} done
          </span>
          {todo.blocked > 0 && (
            <span className="text-red-500">{todo.blocked} blocked</span>
          )}
          {todo.inProgress > 0 && (
            <span className="text-amber-500">
              {todo.inProgress} in progress
            </span>
          )}
        </div>
      </div>
      <ProgressBar value={todo.progress} className="mb-3" />

      <div className="mb-3">
        <UpdateForm
          label="Update"
          placeholder={`Update TODOs for ${todo.repoName}...`}
          disabled={disabled}
          onSubmit={(instruction, interactionLevel) => {
            onStartAndNavigate("update-todo", {
              workspace: workspacePath,
              instruction,
              interactionLevel,
              repo: todo.repoName,
            });
          }}
          batchItems={(instruction, interactionLevel) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                onStartAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
                  interactionLevel,
                  repo: todo.repoName,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 PR",
              onClick: () =>
                onStartAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-pr",
                  workspace: workspacePath,
                  interactionLevel,
                  repo: todo.repoName,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                onStartAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr-gated",
                  workspace: workspacePath,
                  interactionLevel,
                  repo: todo.repoName,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR",
              onClick: () =>
                onStartAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr",
                  workspace: workspacePath,
                  interactionLevel,
                  repo: todo.repoName,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
          ]}
        />
      </div>

      <div className="space-y-3">
        {todo.sections.length > 0
          ? todo.sections.map((section, i) => (
              <SectionBlock key={i} section={section} />
            ))
          : todo.items.map((item, i) => <TodoItemRow key={i} item={item} />)}
      </div>
    </Card>
  );
}
