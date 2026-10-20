/**
 * Prompts for a Slack thread bound to a workspace by a `ws` mention.
 *
 * Two agents: a one-shot planner that turns the request into what quick create
 * takes (repositories, task type, name), and the thread's conversation, which
 * runs inside the workspace. Unlike the unbound Slack conversation
 * (`slack-chat.ts`) this one may change the worktrees, because the workspace
 * exists for that; it still may not commit or publish, which is what `init` in
 * the same thread and the WebUI's operations are for. As there, the write
 * policy is enforced by the system prompt alone.
 */

import type { SelectableRepository } from "@/types/workspace";
import { TASK_README_EDIT, TASK_README_SCOPE } from "./chat";
import {
  SLACK_DESTRUCTIVE_LIMIT,
  SLACK_MEMORY_POLICY,
  SLACK_REPLY_STYLE,
  SLACK_REQUESTED_WRITES,
  memoryContext,
  threadTranscriptSection,
  userMessageSection,
} from "./slack-chat";

const TASK_TYPES = ["feature", "bugfix", "research", "review"] as const;
type TaskType = (typeof TASK_TYPES)[number];

export const SLACK_WORKSPACE_PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    repositories: {
      type: "array",
      items: { type: "string" },
      description:
        "Repository paths (github.com/org/repo) or GitHub PR URLs to give the workspace a worktree of. Empty when the request does not say enough to tell.",
    },
    taskType: { type: "string", enum: [...TASK_TYPES] },
    name: {
      type: "string",
      description: "Short English title for the request, under 70 characters.",
    },
  },
  required: ["repositories", "taskType", "name"],
  additionalProperties: false,
};

export interface SlackWorkspacePlan {
  repositories: string[];
  taskType: TaskType;
  name: string;
}

export function buildSlackWorkspacePlanPrompt(
  description: string,
  repositories: SelectableRepository[],
): string {
  const list = repositories.length > 0
    ? repositories.map((r) => `- ${r.repoPath}`).join("\n")
    : "(none cloned yet)";
  return `A workspace is about to be created for the request below: one git worktree per repository you name, and a README titled with the name you give. Decide those from the request and the list alone — do not use any tools.

- **repositories**: the repositories the request needs changed or examined. Take them from the cloned list, matching what the request names or plainly refers to (a repository's name, its service, a file path inside it). A repository path or a GitHub PR URL written in the request counts even when it is not in the list; give a PR URL as written, so its own branch is checked out. Name each repository once. When the request does not let you tell which repository it is about, return an empty array rather than a guess — the user is then asked to name it.
- **taskType**: \`bugfix\` when the end goal is fixing wrong behaviour, \`review\` when it is reviewing a pull request, \`research\` when it is an investigation with no code change, otherwise \`feature\`.
- **name**: a concise English title for the request, under 70 characters.

Cloned repositories:
${list}

Request:
${description}`;
}

/** The planner's structured answer, or `null` when the text is not one. */
export function parseSlackWorkspacePlan(text: string | undefined): SlackWorkspacePlan | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  const repositories = Array.isArray(raw.repositories)
    ? [...new Set(raw.repositories.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter(Boolean))]
    : [];
  const taskType = TASK_TYPES.includes(raw.taskType as TaskType) ? (raw.taskType as TaskType) : "feature";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  return { repositories, taskType, name };
}

/**
 * System prompt for the bound conversation (passed via
 * --append-system-prompt-file). The only guardrail on what it writes.
 */
export function getSlackWorkspaceChatSystemPrompt(): string {
  return `You are working in a Slack thread that is bound to one ai-workspace workspace. Your working directory is that workspace: it contains README.md (the task and which repositories have worktrees here, and where), TODO-*.md files (task tracking) and artifacts/ (review and research reports, notes). Read the TODO files and artifacts when a question calls for them, so you see their current state — an operation may be rewriting them.

ANSWER QUESTIONS, CARRY OUT REQUESTS. A question gets an answer, from reading the workspace and its worktrees; it is not a cue to change anything. A request for a change is yours to carry out without asking permission to begin: find the code involved, make the change in the worktrees the README declares, and verify it with the repository's own checks (its lint / test / build commands — a \`## Repository Constraints\` section in the README lists them). Report what you did. Ask only when a decision is genuinely the user's — an ambiguity where the choices lead to materially different work, or a change reaching further than they asked; for anything you can settle from the code, settle it and say which assumption you took.

WHERE YOU MAY WRITE:
- files inside the worktrees the README declares;
- this workspace's \`artifacts/\`, for notes, drafts or data the user asked you to keep — tell them the path;
- the README's \`# Task:\` heading and \`## Goal\`, only in the first-turn step you are given;
- your memory database (see MEMORY).
Nothing else. The README's other sections and the \`TODO-*.md\` files are written by the pipeline's own phases, and its verifier and gate treat them as authoritative. Other workspaces, \`repositories/\` (the clones the worktrees come from) and \`.ai-workspace/\` are outside this thread.

EXTERNAL ACTIONS. ${SLACK_REQUESTED_WRITES}

TWO HARD LIMITS — forbidden even when the user explicitly asks. Explain briefly and point them to \`init <what to do>\` in this thread, which plans and runs the work on this workspace through to a pull request, or to the workspace's operations in the WebUI:
1. Recording or publishing changes: no \`git commit/push/rebase/reset/checkout/switch/stash/merge\`, no new branches, no \`gh pr create/edit/merge/comment/review\`, no replies on pull requests. Leave your changes uncommitted in the worktree, and say so when you report. Reading is always fine (\`git log/diff/status/show\`, \`gh ... view/list\`).
2. ${SLACK_DESTRUCTIVE_LIMIT}

AN OPERATION MAY BE RUNNING. When a message says an operation is running on this workspace, that turn is read-only: the operation is editing the same worktrees. Read and answer, and tell the user any change has to wait until it finishes.

${SLACK_MEMORY_POLICY}

${SLACK_REPLY_STYLE}`;
}

export interface SlackWorkspaceChatPromptOptions {
  /** The workspace was created for this message, so its README still needs the Task heading and Goal. */
  newWorkspace?: boolean;
  /** Type of an operation running on the workspace right now, which makes this turn read-only. */
  runningOperation?: string;
  threadContext?: string;
  memoryDbPath?: string;
  userId?: string;
}

function runningOperationNotice(type: string): string {
  return `--- An operation (${type}) is running on this workspace right now ---
This turn is read-only: do not edit any file. Read and answer, and tell the user a change has to wait until the operation finishes.`;
}

function firstTurnContext(workspacePath: string, newWorkspace: boolean): string {
  const readme = `${workspacePath}/README.md`;
  const lines = [
    `Workspace: ${workspacePath} (your working directory)`,
    `Read ${readme} before anything else: it says which repositories have worktrees here and where they are.`,
  ];
  if (newWorkspace) {
    lines.push(
      "",
      "This workspace was just created for the request below. After reading the README, make " +
        TASK_README_EDIT.replace(/^One Edit call/, "one Edit call") +
        " Then start on the request.",
      "",
      `That edit is ${TASK_README_SCOPE}`,
    );
  }
  return lines.join("\n");
}

/**
 * Build one turn of the bound conversation. The first turn of a session carries
 * the workspace, memory and thread transcript; a resume turn sends only the
 * message, since the session holds the rest. The running-operation notice goes
 * on every turn it applies to, because it describes now, not the session.
 */
export function buildSlackWorkspaceChatPrompt(
  workspacePath: string,
  message: string,
  isFirstTurn: boolean,
  opts: SlackWorkspaceChatPromptOptions = {},
): string {
  const parts: string[] = [];
  if (isFirstTurn) {
    parts.push(firstTurnContext(workspacePath, opts.newWorkspace ?? false));
    if (opts.memoryDbPath && opts.userId) parts.push(memoryContext(opts.memoryDbPath, opts.userId));
    if (opts.threadContext?.trim()) parts.push(threadTranscriptSection(opts.threadContext));
  }
  if (opts.runningOperation) parts.push(runningOperationNotice(opts.runningOperation));
  if (parts.length === 0) return message;
  parts.push(userMessageSection(message));
  return parts.join("\n\n");
}
