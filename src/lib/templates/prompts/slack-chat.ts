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
 */
export function buildSlackChatPrompt(
  workspaceRoot: string,
  message: string,
  isFirstTurn: boolean,
): string {
  if (!isFirstTurn) return message;
  return `${slackChatInstructions(workspaceRoot)}\n\n---\n\n${message}`;
}
