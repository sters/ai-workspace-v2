"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TodoFile } from "@/types/workspace";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { Card } from "../shared/containers/card";
import { ProgressBar } from "../shared/feedback/progress-bar";
import { SplitButton, type SplitButtonItem } from "../shared/buttons/split-button";
import { Button } from "../shared/buttons/button";
import { Textarea } from "../shared/forms/textarea";
import { StatusText } from "../shared/feedback/status-text";
import { useRunningOperations } from "@/hooks/use-running-operations";
import type { OperationType } from "@/types/operation";

function UpdateForm({
  label,
  placeholder,
  onSubmit,
  disabled,
  batchItems,
}: {
  label: string;
  placeholder: string;
  onSubmit: (instruction: string) => void;
  disabled: boolean;
  /** When provided, renders a SplitButton with batch dropdown items. */
  batchItems?: (instruction: string) => SplitButtonItem[];
}) {
  const [instruction, setInstruction] = useState("");

  const handleSubmit = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setInstruction("");
  };

  const items = batchItems ? batchItems(instruction) : undefined;

  return (
    <div className="space-y-2">
      <Textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      <div className="flex justify-end">
        {items ? (
          <SplitButton
            label={label}
            onClick={handleSubmit}
            disabled={disabled || !instruction.trim()}
            items={items}
          />
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={disabled || !instruction.trim()}
          >
            {label}
          </Button>
        )}
      </div>
    </div>
  );
}

function RepoTodoCard({
  todo,
  workspacePath,
  disabled,
  onStartAndNavigate,
}: {
  todo: TodoFile;
  workspacePath: string;
  disabled: boolean;
  onStartAndNavigate: (type: OperationType, body: Record<string, string>) => void;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{todo.repoName}</h3>
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
          onSubmit={(instruction) => {
            onStartAndNavigate("update-todo", {
              workspace: workspacePath,
              instruction,
              repo: todo.repoName,
            });
          }}
          batchItems={(instruction) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                onStartAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
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

export function TodoUpdater({
  todos,
  workspacePath,
  workspaceName,
}: {
  todos: TodoFile[];
  workspacePath: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const { isWorkspaceTypeRunning } = useRunningOperations();
  const isRunning = isWorkspaceTypeRunning(workspaceName, "update-todo");

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
          disabled={isRunning}
          onSubmit={(instruction) => {
            startAndNavigate("update-todo", {
              workspace: workspacePath,
              instruction,
            });
          }}
          batchItems={(instruction) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 PR",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-pr",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr-gated",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
          ]}
        />
      </Card>

      {/* Per-repo cards */}
      {todos.map((todo) => (
        <RepoTodoCard
          key={todo.filename}
          todo={todo}
          workspacePath={workspacePath}
          disabled={isRunning}
          onStartAndNavigate={startAndNavigate}
        />
      ))}
    </div>
  );
}
