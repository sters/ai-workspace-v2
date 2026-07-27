import path from "node:path";
import { existsSync } from "node:fs";
import type { TodoFile } from "@/types/workspace";

/**
 * System prompt for interactive chat sessions.
 * Constrains the startup behavior so Claude does not turn the embedded
 * README/TODO context into an excuse for proactive investigation.
 */
export function getChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

The initial user message embeds the current README and TODO summary as REFERENCE MATERIAL only.

Your first turn consists of exactly two things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command, no \`&&\`/\`;\`.
2. One short sentence, e.g. "Ready." — then stop and wait for the user's next message.

Treat the embedded README/TODO/review content as silent reference: it is there so you don't have to read it later, not as a topic to open with. Investigating (Read/Grep/Glob, git status, git log, gh pr, ls), summarizing that content, and proposing next steps all belong to later turns, only once the user asks — that is what the rest of the conversation is for.`;
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
    workingDirectorySection(workspacePath),
    "## Reference Material (do NOT analyze, summarize, or act on this until I explicitly ask)",
    "",
    "The README and TODO summary below are pre-loaded so you don't have to read them with the Read tool. Treat them as silent reference. After your `cd`, just acknowledge readiness in one short sentence and wait for my question.",
    "",
    "### README.md",
    readme || "(no README.md)",
    "",
    "### TODO Progress",
    formatTodoSummary(todos),
  ];
  return parts.join("\n");
}

/**
 * System prompt for review-focused chat sessions.
 * Review chats DO have explicit discussion intent (the review summary is
 * the topic), so Claude may engage with that content — but still must not
 * sprawl into unrelated investigation at startup.
 */
export function getReviewChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

The initial user message includes the current README, TODO summary, and review summary so you have context for the discussion.

Your first turn consists of exactly two things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command.
2. A brief acknowledgement (1-2 sentences) about the review topic, then wait for the user's question.

The context you need for that acknowledgement is already in this message. Reach for files (Read/Glob/Grep) or verification commands (git status, git log, gh pr) once the user's question calls for them.`;
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
    workingDirectorySection(workspacePath),
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

/**
 * System prompt for research-focused chat sessions. Same constraints as the
 * review chat prompt — discussion intent is explicit (the research summary
 * is the topic), but startup must not sprawl into unrelated investigation.
 */
export function getResearchChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and research artifacts.

The initial user message includes the current README, TODO summary, and research summary so you have context for the discussion.

Your first turn consists of exactly two things:

1. One Bash call: \`cd <workspace path from the user prompt>\` on its own — no other command.
2. A brief acknowledgement (1-2 sentences) about the research topic, then wait for the user's question.

The context you need for that acknowledgement is already in this message. Reach for files (Read/Glob/Grep) or verification commands (git status, git log, gh pr) once the user's question calls for them.`;
}

/**
 * Build the initial prompt for a chat session focused on research results.
 * Embeds README, TODO summary, and research summary.md content.
 */
export async function buildResearchChatPrompt(
  workspaceId: string,
  workspacePath: string,
  options?: { readme?: string | null; todos?: TodoFile[]; researchSummary?: string | null },
): Promise<string> {
  const readme = options?.readme ?? await readFileIfExists(path.join(workspacePath, "README.md"));
  const todos = options?.todos ?? await listTodoFilesRaw(workspacePath);
  const researchSummary = options?.researchSummary ?? await readFileIfExists(
    path.join(workspacePath, "artifacts", "research", "summary.md"),
  );

  const parts = [
    workingDirectorySection(workspacePath),
    `I want to discuss the research results for workspace "${workspaceId}".`,
    `The research artifacts are located at: ${workspacePath}/artifacts/research/`,
    "",
    "## README.md",
    readme || "(no README.md)",
    "",
    "## TODO Progress",
    formatTodoSummary(todos),
    "",
    "## Research Summary",
    researchSummary || "(no summary.md found)",
  ];
  return parts.join("\n");
}

/**
 * Build the "Working Directory" preamble injected at the top of every chat
 * init prompt. The Claude CLI is spawned with cwd = ai-workspace root so that
 * `.claude/settings.local.json` (permissions + managed hooks) is auto-loaded;
 * we then instruct Claude to cd into the feature workspace, mirroring how
 * pipeline prompts (`executor.ts` etc.) handle the same constraint.
 */
function workingDirectorySection(workspacePath: string): string {
  return [
    "### Working Directory",
    "",
    `Workspace path: \`${workspacePath}\``,
    "",
    "**Required first action:** issue exactly one Bash call:",
    "",
    "```bash",
    `cd ${workspacePath}`,
    "```",
    "",
    "Issue it on its own, then follow the first-turn shape in the system prompt (brief acknowledgement, then wait for the user).",
    "",
  ].join("\n");
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
