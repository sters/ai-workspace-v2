/**
 * System prompt for interactive chat sessions.
 */
export function getChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

Please start by reading the workspace README.md to understand the current state and goals, then let me know what you find.`;
}

/**
 * Build the initial prompt sent to Claude when starting an interactive chat session.
 */
export function buildInitPrompt(workspaceId: string, workspacePath: string): string {
  return `Workspace: "${workspaceId}"
Workspace directory: ${workspacePath}`;
}

/**
 * System prompt for review-focused chat sessions.
 */
export function getReviewChatSystemPrompt(): string {
  return `You are working on an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

Please start by reading the review summary file (SUMMARY.md) in the review artifacts directory, and also read the workspace README.md for context. Then summarize the key findings and let me know what you'd like to discuss.`;
}

/**
 * Build the initial prompt for a chat session focused on a specific review.
 */
export function buildReviewChatPrompt(
  workspaceId: string,
  workspacePath: string,
  reviewTimestamp: string,
): string {
  return `Workspace: "${workspaceId}"
Workspace directory: ${workspacePath}

I want to discuss the review session from timestamp "${reviewTimestamp}".
The review artifacts are located at: ${workspacePath}/artifacts/reviews/${reviewTimestamp}/`;
}
