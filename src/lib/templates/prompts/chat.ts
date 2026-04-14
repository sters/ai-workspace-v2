import path from "node:path";
import { existsSync } from "node:fs";
import type { TodoFile } from "@/types/workspace";

/**
 * System prompt for interactive chat sessions.
 * Instructs Claude NOT to read files proactively — all context is provided in the initial prompt.
 */
export function getChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

The initial user message includes the current README and TODO summary. Do NOT proactively read additional files (README.md, TODO files, git log, gh pr, etc.) at startup. Only read files when the user explicitly asks you to.`;
}

/** Format TODO files into a concise summary string. */
function formatTodoSummary(todos: TodoFile[]): string {
  if (todos.length === 0) return "(no TODO files)";
  return todos
    .map((t) => {
      const line = `${t.filename}: ${t.completed}/${t.total} completed`;
      const pending = t.items
        .filter((i) => i.status === "pending" || i.status === "in_progress")
        .map((i) => `  - [${i.status === "in_progress" ? "~" : " "}] ${i.text}`)
        .join("\n");
      return pending ? `${line}\n${pending}` : line;
    })
    .join("\n\n");
}

/**
 * Build the initial prompt sent to Claude when starting an interactive chat session.
 * Embeds README content and TODO summary so Claude doesn't need to read files at startup.
 */
export async function buildInitPrompt(
  workspaceId: string,
  workspacePath: string,
  options?: { readme?: string | null; todos?: TodoFile[] },
): Promise<string> {
  const readme = options?.readme ?? await readFileIfExists(path.join(workspacePath, "README.md"));
  const todos = options?.todos ?? await listTodoFilesRaw(workspacePath);

  const parts = [
    `Workspace: "${workspaceId}"`,
    `Workspace directory: ${workspacePath}`,
    "",
    "## README.md",
    readme || "(no README.md)",
    "",
    "## TODO Progress",
    formatTodoSummary(todos),
  ];
  return parts.join("\n");
}

/**
 * System prompt for review-focused chat sessions.
 * Instructs Claude NOT to read files proactively — all context is provided in the initial prompt.
 */
export function getReviewChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

The initial user message includes the current README, TODO summary, and review summary. Do NOT proactively read additional files at startup. Only read files when the user explicitly asks you to.`;
}

/**
 * Build the initial prompt for a chat session focused on a specific review.
 * Embeds README, TODO summary, and review SUMMARY.md content.
 */
export async function buildReviewChatPrompt(
  workspaceId: string,
  workspacePath: string,
  reviewTimestamp: string,
  options?: { readme?: string | null; todos?: TodoFile[]; reviewSummary?: string | null },
): Promise<string> {
  const readme = options?.readme ?? await readFileIfExists(path.join(workspacePath, "README.md"));
  const todos = options?.todos ?? await listTodoFilesRaw(workspacePath);
  const reviewSummary = options?.reviewSummary ?? await readFileIfExists(
    path.join(workspacePath, "artifacts", "reviews", reviewTimestamp, "SUMMARY.md"),
  );

  const parts = [
    `Workspace: "${workspaceId}"`,
    `Workspace directory: ${workspacePath}`,
    "",
    `I want to discuss the review session from timestamp "${reviewTimestamp}".`,
    `The review artifacts are located at: ${workspacePath}/artifacts/reviews/${reviewTimestamp}/`,
    "",
    "## README.md",
    readme || "(no README.md)",
    "",
    "## TODO Progress",
    formatTodoSummary(todos),
    "",
    "## Review Summary",
    reviewSummary || "(no SUMMARY.md found)",
  ];
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers — lightweight file I/O to avoid importing the full workspace reader
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  return (await file.exists()) ? file.text() : null;
}

import { parseTodoFile } from "@/lib/parsers/todo";

async function listTodoFilesRaw(wsPath: string): Promise<TodoFile[]> {
  if (!existsSync(wsPath)) return [];
  const glob = new Bun.Glob("TODO-*.md");
  const files = [...glob.scanSync({ cwd: wsPath })].filter((f) => f !== "TODO-template.md");
  const results: TodoFile[] = [];
  for (const f of files) {
    const content = await Bun.file(path.join(wsPath, f)).text();
    results.push(parseTodoFile(f, content));
  }
  return results;
}
