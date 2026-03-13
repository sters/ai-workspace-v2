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
import type { InteractionLevel } from "@/types/prompts";
import {
  Play,
  ClipboardCheck,
  GitPullRequest,
  CodeXml,
  Terminal,
} from "lucide-react";

const INTERACTION_LEVELS: { value: InteractionLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "mid", label: "Mid" },
  { value: "high", label: "High" },
];

function InteractionLevelSelector({
  value,
  onChange,
  disabled,
}: {
  value: InteractionLevel;
  onChange: (level: InteractionLevel) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {INTERACTION_LEVELS.map(({ value: level, label }) => (
        <button
          key={level}
          onClick={() => onChange(level)}
          disabled={disabled}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            value === level
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function UpdateForm({
  label,
  placeholder,
  onSubmit,
  disabled,
  batchItems,
}: {
  label: string;
  placeholder: string;
  onSubmit: (instruction: string, interactionLevel: InteractionLevel) => void;
  disabled: boolean;
  /** When provided, renders a SplitButton with batch dropdown items. */
  batchItems?: (instruction: string, interactionLevel: InteractionLevel) => SplitButtonItem[];
}) {
  const [instruction, setInstruction] = useState("");
  const [interactionLevel, setInteractionLevel] = useState<InteractionLevel>("mid");

  const handleSubmit = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    onSubmit(trimmed, interactionLevel);
    setInstruction("");
  };

  const items = batchItems ? batchItems(instruction, interactionLevel) : undefined;

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
      <div className="flex items-center justify-end gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Interaction:</span>
          <InteractionLevelSelector
            value={interactionLevel}
            onChange={setInteractionLevel}
            disabled={disabled}
          />
        </div>
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

function openInEditor(targetPath: string) {
  return fetch("/api/operations/open-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open editor:", data.error);
    }
  });
}

function openInTerminal(targetPath: string) {
  return fetch("/api/operations/open-terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace: targetPath }),
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json();
      console.error("Failed to open terminal:", data.error);
    }
  });
}

function RepoTodoCard({
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
          onSubmit={(instruction, interactionLevel) => {
            startAndNavigate("update-todo", {
              workspace: workspacePath,
              instruction,
              interactionLevel,
            });
          }}
          batchItems={(instruction, interactionLevel) => [
            {
              label: "Update \u2192 Execute \u2192 Review",
              onClick: () =>
                startAndNavigate("batch", {
                  startWith: "update-todo",
                  mode: "execute-review",
                  workspace: workspacePath,
                  interactionLevel,
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
                  interactionLevel,
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
                  interactionLevel,
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
                  interactionLevel,
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
          repoPath={findRepoPath(todo.repoName, repositories ?? [])}
          onStartAndNavigate={startAndNavigate}
        />
      ))}
    </div>
  );
}
