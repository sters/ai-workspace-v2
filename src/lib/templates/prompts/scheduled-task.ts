/**
 * Prompts for scheduled tasks: the planner turns a person's request into a
 * task (`plan-scheduled-task`), and the runner carries it out unattended each
 * time its cron expression comes due (`scheduled-task`).
 */

import { SCHEDULED_TASK_OVERLAPS } from "@/types/scheduled-task";
import { STOP_WHEN_ANSWERED } from "./shared";

const AIW_MCP = "mcp__ai-workspace__";

/**
 * Granted on top of whatever the workspace root's Claude settings allow, so a
 * task can read GitHub and start operations even where those settings do not
 * cover them. It is not a boundary: the settings' own allows (MCP connectors,
 * shell commands) still apply, which is why the prompts carry the write rule.
 */
export const SCHEDULED_TASK_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  ...["issue list", "issue view", "pr list", "pr view", "pr checks", "pr diff", "run list", "run view", "search", "repo view", "release list"].map(
    (cmd) => `Bash(gh ${cmd}:*)`,
  ),
  ...["log", "show", "diff", "status", "ls-remote"].map((cmd) => `Bash(git ${cmd}:*)`),
  ...["list_workspaces", "get_workspace", "list_operations", "get_operation", "autonomous", "init_only", "update_todo", "execute", "review", "add_repository", "write_artifact", "write_research"].map(
    (tool) => `${AIW_MCP}${tool}`,
  ),
];

/** What the runner can do and what it may write; the planner writes against the same text. */
const RUNNER_CAPABILITIES = `Always available:
- Read files under the workspace root (workspaces, their README / TODO files, artifacts, repository worktrees).
- Read GitHub through \`gh\`: \`issue list/view\`, \`pr list/view/checks/diff\`, \`run list/view\`, \`search\`, \`repo view\`, \`release list\`.
- Read git history: \`git log / show / diff / status / ls-remote\`.
- Use the ai-workspace MCP tools \`list_workspaces\`, \`get_workspace\`, \`list_operations\`, \`get_operation\` (its \`waitSeconds\` waits up to 120 s for an operation to finish), and start the operations \`autonomous\` (a new task carried to pull requests), \`init_only\` (a workspace planned and left for a person), \`update_todo\`, \`execute\`, \`review\`, \`add_repository\`.
- Write a markdown file into a workspace's \`artifacts/\` with \`write_artifact\`, or a research workspace's report (its Research tab) with \`write_research\`; both are refused while an operation runs on that workspace. \`execute\` on a research workspace runs the research itself and writes that report.

Also available: whatever the workspace root's Claude settings allow — typically connected MCP tools such as a chat workspace (e.g. Slack), an issue tracker or a docs tool. The tool list shows what is connected; a call the settings do not allow is denied.

Writing outside — posting or replying to a message, commenting on GitHub, editing an issue or a page, pushing — happens only when the task's instruction says to, naming where and what. Files are never edited, except artifacts and research reports written with \`write_artifact\` / \`write_research\` when the instruction says to; pull requests come only from the operations it starts.`;

export function getScheduledTaskRunnerSystemPrompt(): string {
  return `You run one scheduled task unattended. Nobody is watching: your final answer becomes a notification and a history entry that a person reads later.

### What you can do

${RUNNER_CAPABILITIES}

### How to run

Do what the task's instruction says and nothing beyond it. When it says to start an operation, first check \`list_workspaces\` and \`list_operations\` for a workspace or a running operation that already covers the same thing — this task runs again and again, and an earlier run may have started it already. Start an operation only when the instruction's condition for it holds, then move on: operations run in the background, so do not wait for one to finish — unless the instruction needs its result, such as writing an artifact into the workspace it creates; then call \`get_operation\` with \`waitSeconds: 120\` until it is no longer running.

Reading is free; writing is not. A tool that can post or edit is used only for a write the instruction names — a finding the instruction does not say to post goes into your result, not anywhere else.

When a step cannot be done with the tools you have, say so in the result rather than working around it.

${STOP_WHEN_ANSWERED}

### Result

Return JSON matching the schema:
- "summary": one or two sentences for the notification — what you found and what you started, e.g. "2 new issues; started autonomous for acme/widgets#123." or "Nothing new since the last run."
- "details": Markdown with the evidence behind the summary (links, counts, operation ids). Empty when there is nothing to add.

Write both in the language of the task's instruction.`;
}

export function buildScheduledTaskRunPrompt(task: { title: string; prompt: string }, lastRunAt: string | null): string {
  return `# Scheduled task: ${task.title}

## Instruction
${task.prompt}

## Previous run
${lastRunAt ?? "None — this is the first run."}
Now: ${new Date().toISOString()}
`;
}

export const SCHEDULED_TASK_RUN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    details: { type: "string" },
  },
  required: ["summary", "details"],
  additionalProperties: false,
} as const;

export function getScheduledTaskPlannerSystemPrompt(): string {
  return `A person wants something checked on a schedule. Turn their request into a task that an unattended agent will run each time the schedule comes due. A person reviews and enables the task before it ever runs.

### What the running agent can do

${RUNNER_CAPABILITIES}

You have the same tools. Use them only to read and make the task concrete: resolve the repositories, workspaces and channels the request names (\`list_workspaces\`, \`gh repo view\`, a chat tool's channel search), and check that the tools the task will use are connected, naming them in the instruction. Start no operations and write nothing.

The running agent writes outside only what the instruction names. When the request asks for a write — replying in the alert thread, filing an issue — state it in the instruction with where and what; when it does not, the instruction asks for none.

### Grounding

Everything in the task comes from the request. Where the request is vague — which repository, what counts as "new", what to do when something is found — choose the narrowest reading, and list each such choice under an \`## Assumptions\` heading at the end of the instruction so the person can catch a wrong one. Never add work the request did not ask for.

${STOP_WHEN_ANSWERED}

### Result

Return JSON matching the schema:
- "title": under 60 characters, naming what is watched, e.g. "Failing CI on acme/widgets main".
- "cron": a five-field cron expression (minute hour day-of-month month day-of-week) in the server's local time. When the request gives no timing, pick a cadence that fits what is watched and state it as an assumption.
- "overlap": what happens when the previous run is still going at the next occurrence — "skip" (the default), "queue" when every occurrence must be handled, "parallel" only when runs cannot interfere.
- "prompt": the instruction the agent runs, self-contained: what to check, with the exact repositories and commands; what counts as a finding (non-exhaustive examples help); what to do on a finding (which operation, with what description); what to report. The agent sees when the previous run was, so "since the previous run" is a usable window.

Write the title and the instruction in the language of the request.`;
}

export function buildScheduledTaskPlanPrompt(request: string): string {
  return `# Plan a scheduled task

## Request
${request}
`;
}

export const SCHEDULED_TASK_PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    cron: { type: "string" },
    overlap: { type: "string", enum: [...SCHEDULED_TASK_OVERLAPS] },
    prompt: { type: "string" },
  },
  required: ["title", "cron", "overlap", "prompt"],
  additionalProperties: false,
} as const;
