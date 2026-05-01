"use client";

import type { TodoFile } from "@/types/workspace";
import type { OperationType } from "@/types/operation";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { UpdateForm } from "./update-form";
import { Card } from "../shared/containers/card";
import { ProgressBar } from "../shared/feedback/progress-bar";
import { Button } from "../shared/buttons/button";
import {
  DropdownMenu,
  type DropdownItem,
} from "../shared/menus/dropdown-menu";
import { showToast } from "../shared/feedback/toast";
import { openWith } from "@/lib/api";
import { useOpeners } from "@/hooks/use-openers";
import { buildBatchItems, buildAutonomousItems } from "@/lib/batch-modes";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  FolderOpen,
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
  const { openers } = useOpeners();
  const openerItems: DropdownItem[] = openers.map((opener) => ({
    kind: "leaf" as const,
    label: opener.name,
    onSelect: async () => {
      try {
        await openWith(workspacePath, opener.name, repoPath);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : `Failed to launch ${opener.name}`,
          "error",
        );
      }
    },
  }));

  const baseBody = {
    workspace: workspacePath,
    repo: todo.repoName,
  };

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
            {repoPath && openerItems.length > 0 && (
              <DropdownMenu
                ariaLabel="Open in..."
                trigger={<FolderOpen className="h-3.5 w-3.5" />}
                triggerClassName="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                items={openerItems}
              />
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
              ...baseBody,
              workspace: workspacePath,
              instruction,
              interactionLevel,
            });
          }}
          batchItems={(instruction, interactionLevel) => {
            const base = {
              ...baseBody,
              workspace: workspacePath,
              interactionLevel,
              ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            };
            return [
              ...buildBatchItems("update-todo", base, (body) => onStartAndNavigate("batch", body)),
              ...buildAutonomousItems("update-todo", base, (body) => onStartAndNavigate("autonomous", body)),
            ];
          }}
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
