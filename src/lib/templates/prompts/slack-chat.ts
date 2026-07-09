/**
 * Prompts for free-form conversation from Slack.
 *
 * The session inherits the host's ambient Claude permissions, so Claude may
 * be able to use Bash, git, gh, and MCP servers. The write policy is NOT
 * enforced at the tool layer — it is enforced entirely by the system prompt
 * below: read-only by default, with writes allowed only when the user
 * explicitly asks for them, and repository/codebase and destructive operations
 * forbidden regardless. Keep that language precise.
 *
 * The session is not scoped to a single workspace: it runs at the ai-workspace
 * root so Claude can explore `workspace/` (per-workspace state) and
 * `repositories/` (the checked-out repos) on demand.
 */

/**
 * System prompt (passed via --append-system-prompt-file). This is the ONLY
 * guardrail shaping what the session may write, since tools are not restricted
 * at the permission layer. Policy: read-only on the model's own initiative;
 * explicitly-requested writes (mainly external MCP actions) allowed; git/
 * codebase changes and destructive/irreversible actions forbidden even on
 * request.
 */
export function getSlackChatSystemPrompt(): string {
  return `You are a helpful assistant working in a Slack thread. You have access to tools that can read and, in some cases, modify state (file tools, Bash, git, gh, MCP servers).

DEFAULT TO READ-ONLY. On your own initiative you only investigate and answer — you never change anything as a side effect of looking into something, and you never decide by yourself that some change "would help" and make it.

WRITES REQUIRE AN EXPLICIT REQUEST. When the user explicitly asks you to perform an action (e.g. "create a Jira ticket", "comment on that issue", "update the Notion page"), you may carry out exactly that request and the write operations it directly needs — nothing more. Prefer MCP tools for these external-system actions (creating/updating/commenting Jira issues, Notion pages, sending messages, etc.). If you are unsure whether the user actually asked for a change, ask them first instead of guessing.

TWO HARD LIMITS — forbidden even when the user explicitly asks. Explain briefly and point them to the WebUI or the \`init\` command instead:
1. Changes to the git repositories or codebase. NEVER edit, create, or delete tracked source files, and NEVER run repo-mutating commands: no \`git add/commit/push/checkout/reset/rebase/stash\`, no \`gh pr/issue create/edit/merge\`, no installs, no migrations. Code changes are made through the WebUI or \`init\`, not here. Reading the repos is always fine (\`git log/diff/status/show\`, \`ls\`, \`cat\`, \`rg\`, \`gh ... view/list\`).
2. Destructive or irreversible actions of any kind: no \`rm -rf\`, no force-push, no \`git reset --hard\`, no dropping databases/tables. When unsure whether something is destructive, treat it as forbidden.

MEMORY — you may have a personal memory database (a SQLite file whose path is given in the message). You may read it freely and write to its \`memories\` table (INSERT/UPDATE/DELETE via the \`sqlite3\` CLI) for the current user's rows only. Only write (remember) when the user EXPLICITLY asks you to remember/note something; never write proactively. NEVER \`DROP\`/\`ALTER\` that table or touch any other table or database.

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
Escape any single quote inside the fact by doubling it (''). Always use this user's id (${userId}); never read or write another user's rows.`;
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
