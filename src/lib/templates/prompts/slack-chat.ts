/**
 * Prompts for free-form conversation from Slack.
 *
 * The session inherits the host's ambient Claude permissions, so Claude may
 * be able to use Bash, git, gh, and MCP servers to investigate. Read-only
 * behavior is NOT enforced at the tool layer — it is enforced entirely by the
 * system prompt below, which forbids any state-changing action. Keep that
 * language strong.
 *
 * The session is not scoped to a single workspace: it runs at the ai-workspace
 * root so Claude can explore `workspace/` (per-workspace state) and
 * `repositories/` (the checked-out repos) on demand.
 */

/**
 * System prompt (passed via --append-system-prompt-file). This is the ONLY
 * guardrail keeping the session read-only, since tools are not restricted at
 * the permission layer.
 */
export function getSlackChatSystemPrompt(): string {
  return `You are a helpful assistant answering questions in a Slack thread. You may have access to tools that can modify state (file tools, Bash, git, gh, MCP servers), but this is a strictly READ-ONLY, investigate-and-answer session.

ABSOLUTE CONSTRAINT — DO NOT CHANGE ANYTHING. This is non-negotiable:
- NEVER create, edit, move, or delete files (no Write/Edit, no output redirection, no rm/mv/cp that alters state).
- Shell: read-only inspection ONLY — e.g. \`git log\`, \`git diff\`, \`git status\`, \`git show\`, \`ls\`, \`cat\`, \`rg\`, \`gh ... view/list\`. NEVER run state-changing commands: no \`git add/commit/push/checkout/reset/rebase/stash\`, no \`gh pr/issue create/edit/merge/comment/close\`, no installs, no migrations.
- MCP tools: use ONLY read/query/search/list/get operations. NEVER call anything that creates, updates, deletes, sends, posts, or comments (e.g. do not create Jira issues, do not update Notion pages, do not send messages).
- If the user asks you to make a change, DO NOT do it. Briefly explain that this is a read-only channel and that changes are triggered from the WebUI or the \`init\` command.
- When unsure whether an action mutates state, treat it as forbidden and don't do it.

STYLE — your replies are posted verbatim into Slack:
- Be concise and conversational; a few sentences usually beats a long report.
- Use only lightweight Markdown that Slack renders: \`*bold*\`, \`_italic_\`, \`\`code\`\`, \`\`\`code blocks\`\`\`. Do NOT use Markdown headings (#).`;
}

/** Working-directory context appended to the first turn (cwd is dynamic). */
function workingContext(workspaceRoot: string): string {
  return `Working directory: ${workspaceRoot}
This is the ai-workspace root. It contains \`workspace/\` (per-workspace README/TODO/review state) and \`repositories/\` (checked-out git repos). Investigate these (read-only) when the question calls for it; otherwise just answer directly.`;
}

/**
 * Build the prompt for a Slack conversation turn.
 *
 * @param workspaceRoot absolute path to the ai-workspace root (cwd of the run)
 * @param message the user's Slack message text
 * @param isFirstTurn when true, prepend the working-directory context; on
 *   resume turns pass false so only the message is sent (the CLI session
 *   retains the earlier context, and the system prompt is re-applied anyway).
 * @param threadContext optional transcript of the surrounding Slack thread,
 *   folded in on the first turn so Claude can answer questions like
 *   "summarize this thread". Ignored on resume turns.
 */
export function buildSlackChatPrompt(
  workspaceRoot: string,
  message: string,
  isFirstTurn: boolean,
  threadContext?: string,
): string {
  if (!isFirstTurn) return message;

  const parts = [workingContext(workspaceRoot)];
  if (threadContext && threadContext.trim() !== "") {
    parts.push(
      "--- Slack thread so far (earlier messages in this thread, for context) ---\n" +
        threadContext,
    );
  }
  parts.push("--- The user's message to you follows ---\n" + message);
  return parts.join("\n\n");
}
