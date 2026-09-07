"use client";

import type { TodoFile } from "@/types/workspace";
import type { OperationType } from "@/types/operation";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { UpdateForm } from "./update-form";
import { SolveBaseConflictsButton } from "./solve-base-conflicts-button";
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
import {
  Bot,
  Play,
  ClipboardCheck,
  GitPullRequest,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";

export function RepoTodoCard({
  todo,
  workspacePath,
  disabled,
  workspaceBusy,
  repoPath,
  onStartAndNavigate,
}: {
  todo: TodoFile;
  workspacePath: string;
  disabled: boolean;
  /**
   * Whether any operation is running on the workspace. Separate from `disabled`
   * (which is this repo's update-todo) because merging the base branch writes to
   * the worktree and pushes, so it must not start under a running executor.
   */
  workspaceBusy?: boolean;
  /** Full repository path (e.g. "github.com/org/repo") for per-repo operations. */
  repoPath: string | undefined;
  onStartAndNavigate: (type: OperationType, body: Record<string, string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = `repo-todo-body-${todo.filename}`;
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
          <h3 className="font-semibold">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((v) => !v)}
              className="-mx-1 flex cursor-pointer items-center gap-1 rounded px-1 transition-colors hover:bg-muted/50"
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              {todo.repoName}
            </button>
          </h3>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost-toggle"
              className="h-6 w-6 p-0"
              disabled={disabled}
              title="Autonomous"
              onClick={() =>
                onStartAndNavigate("autonomous", {
                  ...baseBody,
                  startWith: "execute",
                })
              }
            >
              <Bot className="h-3.5 w-3.5" />
            </Button>
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
      {/* Stays visible while collapsed: one line, and progress is what a
          collapsed card is scanned for. */}
      <ProgressBar value={todo.progress} className={expanded ? "mb-3" : ""} />

      {expanded && (
        <div id={bodyId}>
          <div className="mb-3">
            <UpdateForm
              label="Start autonomous"
              placeholder={`Update TODOs for ${todo.repoName}...`}
              disabled={disabled}
              onSubmit={(instruction, interactionLevel) => {
                onStartAndNavigate("autonomous", {
                  ...baseBody,
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
                    onStartAndNavigate("update-todo", {
                      ...baseBody,
                      workspace: workspacePath,
                      instruction: instruction.trim(),
                      interactionLevel,
                    }),
                },
              ]}
              extraActions={
                <SolveBaseConflictsButton
                  workspacePath={workspacePath}
                  repo={todo.repoName}
                  disabled={disabled || Boolean(workspaceBusy)}
                  onStart={onStartAndNavigate}
                />
              }
            />
          </div>

          <div className="space-y-3">
            {todo.sections.length > 0
              ? todo.sections.map((section, i) => (
                  <SectionBlock key={i} section={section} />
                ))
              : todo.items.map((item, i) => (
                  <TodoItemRow key={i} item={item} />
                ))}
          </div>
        </div>
      )}
    </Card>
  );
}
