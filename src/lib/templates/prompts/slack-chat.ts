/**
 * Prompt for free-form, read-only conversation from Slack.
 *
 * Unlike the interactive workspace chat (chat.ts), this is not scoped to a
 * single workspace: it runs at the ai-workspace root so Claude can explore
 * `workspace/` (per-workspace state) and `repositories/` (the checked-out
 * repos) on demand. Answers go back into a Slack thread, so brevity and
 * plain text matter.
 */

/**
 * Instructions folded into the FIRST turn of a Slack conversation. On resume
 * turns only the raw user message is sent (the CLI session retains these).
 */
function slackChatInstructions(workspaceRoot: string): string {
  return `You are a helpful assistant answering questions in a Slack thread. Your replies are posted verbatim into Slack, so:
- Keep answers concise and conversational. Prefer a few sentences over long reports.
- Use plain text or lightweight Markdown (Slack renders \`*bold*\`, \`_italic_\`, \`\`code\`\`, and \`\`\`code blocks\`\`\`). Do NOT use Markdown headings (#).
- This is a READ-ONLY session: you can read and search files and the web, but you cannot modify anything. If asked to make changes, explain that changes are triggered from the WebUI or the \`init\` command.

Working directory: ${workspaceRoot}
This is the ai-workspace root. It contains \`workspace/\` (per-workspace README/TODO/review state) and \`repositories/\` (checked-out git repos). Read or search these only when the question calls for it; otherwise just answer directly.`;
}

/**
 * Build the prompt for a Slack conversation turn.
 *
 * @param workspaceRoot absolute path to the ai-workspace root (cwd of the run)
 * @param message the user's Slack message text
 * @param isFirstTurn when true, prepend the conversation instructions; on
 *   resume turns pass false so only the message is sent.
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

  const parts = [slackChatInstructions(workspaceRoot)];
  if (threadContext && threadContext.trim() !== "") {
    parts.push(
      "--- Slack thread so far (earlier messages in this thread, for context) ---\n" +
        threadContext,
    );
  }
  parts.push("--- The user's message to you follows ---\n" + message);
  return parts.join("\n\n");
}
