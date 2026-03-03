"use client";

import { useState, useCallback, useMemo } from "react";
import type { TodoFile } from "@/types/workspace";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { ProgressBar } from "../shared/progress-bar";
import { ClaudeOperation } from "../operation/claude-operation";
import { SplitButton, type SplitButtonItem } from "../shared/split-button";
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
      <textarea
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
        className="w-full min-h-[2lh] resize-y rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:opacity-50"
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
          <button
            onClick={handleSubmit}
            disabled={disabled || !instruction.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline operation form: renders both the input form and the operation log
 * directly below it, using its own independent ClaudeOperation state.
 */
function InlineOperationForm({
  storageKey,
  label,
  placeholder,
  disabled,
  onRunningChange,
  onSubmitBody,
  workspace,
  batchItems,
}: {
  storageKey: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  onRunningChange: (running: boolean) => void;
  onSubmitBody: (instruction: string) => Record<string, string>;
  workspace?: string;
  /** When provided, renders a SplitButton with batch dropdown items. */
  batchItems?: (
    start: (type: OperationType, body: Record<string, string>) => void,
    instruction: string,
  ) => SplitButtonItem[];
}) {
  return (
    <ClaudeOperation
      storageKey={storageKey}
      vertical
      onRunningChange={onRunningChange}
      workspace={workspace}
      navigateNextActions
    >
      {(ctx) => (
        <UpdateForm
          label={label}
          placeholder={placeholder}
          disabled={disabled || ctx.isRunning}
          onSubmit={(instruction) => {
            ctx.start("update-todo", onSubmitBody(instruction));
          }}
          batchItems={
            batchItems
              ? (instruction) => batchItems(
                  (type, body) => ctx.start(type, body),
                  instruction,
                )
              : undefined
          }
        />
      )}
    </ClaudeOperation>
  );
}

function RepoTodoCard({
  todo,
  workspacePath,
  workspaceName,
  disabled,
  onRunningChange,
}: {
  todo: TodoFile;
  workspacePath: string;
  workspaceName: string;
  disabled: boolean;
  onRunningChange: (key: string, running: boolean) => void;
}) {
  const handleRunningChange = useCallback(
    (running: boolean) => onRunningChange(todo.repoName, running),
    [onRunningChange, todo.repoName]
  );

  return (
    <div className="rounded-lg border p-4">
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
        <InlineOperationForm
          storageKey={`workspace-todo-repo:${workspaceName}:${todo.repoName}`}
          label="Update"
          placeholder={`Update TODOs for ${todo.repoName}...`}
          disabled={disabled}
          onRunningChange={handleRunningChange}
          workspace={workspacePath}
          onSubmitBody={(instruction) => ({
            workspace: workspacePath,
            instruction,
            repo: todo.repoName,
          })}
          batchItems={(start, instruction) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 PR",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-pr",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr-gated",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR",
              onClick: () =>
                start("batch", {
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
    </div>
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
  // Track which operations are currently running.
  // "workspace" key = workspace-wide operation; repo names = per-repo operations.
  const [runningOps, setRunningOps] = useState<Set<string>>(new Set());

  const updateRunning = useCallback((key: string, running: boolean) => {
    setRunningOps((prev) => {
      const next = new Set(prev);
      if (running) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const handleWorkspaceRunningChange = useCallback(
    (running: boolean) => updateRunning("workspace", running),
    [updateRunning]
  );

  const workspaceWideRunning = runningOps.has("workspace");
  const anyRepoRunning = useMemo(
    () => Array.from(runningOps).some((k) => k !== "workspace"),
    [runningOps]
  );

  if (todos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No TODO files found.</p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workspace-wide update form */}
      <div className="rounded-lg border border-dashed p-4">
        <p className="mb-2 text-sm font-medium">Update workspace TODOs</p>
        <InlineOperationForm
          storageKey={`workspace-todo-all:${workspaceName}`}
          label="Update"
          placeholder="Describe TODO changes to apply across all repositories..."
          disabled={anyRepoRunning}
          onRunningChange={handleWorkspaceRunningChange}
          workspace={workspacePath}
          onSubmitBody={(instruction) => ({
            workspace: workspacePath,
            instruction,
          })}
          batchItems={(start, instruction) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 PR",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-pr",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR (gated)",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr-gated",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
            {
              label: "Update \u2192 Execute \u2192 Review \u2192 PR",
              onClick: () =>
                start("batch", {
                  startWith: "update-todo",
                  mode: "execute-review-pr",
                  workspace: workspacePath,
                  ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
                }),
            },
          ]}
        />
      </div>

      {/* Per-repo cards */}
      {todos.map((todo) => (
        <RepoTodoCard
          key={todo.filename}
          todo={todo}
          workspacePath={workspacePath}
          workspaceName={workspaceName}
          disabled={workspaceWideRunning}
          onRunningChange={updateRunning}
        />
      ))}
    </div>
  );
}
