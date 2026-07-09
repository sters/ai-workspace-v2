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

MEMORY EXCEPTION — the ONE thing you may write:
- You may have a personal memory database (a SQLite file whose path is given in the message). The ONLY write you are ever permitted is INSERT/UPDATE/DELETE on its \`memories\` table via the \`sqlite3\` CLI, and only for the current user's rows.
- Only write (remember) when the user EXPLICITLY asks you to remember/note something. Never write proactively.
- NEVER \`DROP\`/\`ALTER\` that table, never touch any other table, database, or file. Everything outside this one \`memories\` table stays strictly read-only.

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
 * Instructions for the per-user memory database, folded into the first turn.
 * The DB path is dynamic (workspace-derived) and the user id is per-mention, so
 * this lives in the message rather than the static system prompt.
 */
function memoryContext(memoryDbPath: string, userId: string): string {
  return `--- Your memory about this user ---
You keep a small SQLite database of things THIS user has asked you to remember, scoped to their Slack user id. Operate it with the \`sqlite3\` CLI.
- Database file: ${memoryDbPath}
- This user's id: ${userId}
- Table: memories(id, user_id, content, created_at, updated_at)

At the start of a new conversation, recall what you already know about them:
  sqlite3 '${memoryDbPath}' "SELECT content FROM memories WHERE user_id='${userId}' ORDER BY updated_at DESC LIMIT 50;"
Take any relevant memories into account when answering. Only when the user EXPLICITLY asks you to remember/note something, store it (then briefly confirm what you saved):
  sqlite3 '${memoryDbPath}' "INSERT INTO memories(user_id, content) VALUES('${userId}', '<the fact>');"
Escape any single quote inside the fact by doubling it (''). Always use this user's id (${userId}); never read or write another user's rows. This \`memories\` table is the ONLY thing you may write to.`;
}

export interface SlackChatPromptOptions {
  /**
   * Transcript of the surrounding Slack thread, folded in on the first turn so
   * Claude can answer questions like "summarize this thread".
   */
  threadContext?: string;
  /** Absolute path to the per-user memory DB. Omit to disable memory. */
  memoryDbPath?: string;
  /** Slack user id owning the memory rows. Required for memory to be included. */
  userId?: string;
}

/**
 * Build the prompt for a Slack conversation turn.
 *
 * @param workspaceRoot absolute path to the ai-workspace root (cwd of the run)
 * @param message the user's Slack message text
 * @param isFirstTurn when true, prepend the working-directory + memory context;
 *   on resume turns pass false so only the message is sent (the CLI session
 *   retains the earlier context, and the system prompt is re-applied anyway).
 * @param opts first-turn extras (thread transcript, memory DB path + user id).
 *   All ignored on resume turns.
 */
export function buildSlackChatPrompt(
  workspaceRoot: string,
  message: string,
  isFirstTurn: boolean,
  opts: SlackChatPromptOptions = {},
): string {
  if (!isFirstTurn) return message;

  const parts = [workingContext(workspaceRoot)];
  if (opts.memoryDbPath && opts.userId) {
    parts.push(memoryContext(opts.memoryDbPath, opts.userId));
  }
  if (opts.threadContext && opts.threadContext.trim() !== "") {
    parts.push(
      "--- Slack thread so far (earlier messages in this thread, for context) ---\n" +
        opts.threadContext,
    );
  }
  parts.push("--- The user's message to you follows ---\n" + message);
  return parts.join("\n\n");
}
