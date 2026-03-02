"use client";

import { useState, useCallback, useMemo } from "react";
import type { TodoFile } from "@/types/workspace";
import { TodoItemRow } from "./todo-item";
import { SectionBlock } from "./todo-viewer";
import { ProgressBar } from "../shared/progress-bar";
import { ClaudeOperation } from "../operation/claude-operation";

function UpdateForm({
  label,
  placeholder,
  onSubmit,
  disabled,
}: {
  label: string;
  placeholder: string;
  onSubmit: (instruction: string) => void;
  disabled: boolean;
}) {
  const [instruction, setInstruction] = useState("");

  const handleSubmit = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setInstruction("");
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSubmit();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground disabled:opacity-50"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !instruction.trim()}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {label}
      </button>
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
}: {
  storageKey: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  onRunningChange: (running: boolean) => void;
  onSubmitBody: (instruction: string) => Record<string, string>;
  workspace?: string;
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
