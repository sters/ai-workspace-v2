/**
 * System prompt for one-shot quick ask about a workspace.
 */
export function getQuickAskSystemPrompt(): string {
  return `You are answering a question about an ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

First read the workspace README.md and any relevant TODO files to understand the current state, then answer the following question concisely.`;
}

/**
 * Build the prompt for a one-shot quick ask about a workspace.
 */
export function buildQuickAskPrompt(
  workspace: string,
  workspacePath: string,
  question: string,
): string {
  return `Workspace: "${workspace}"
Workspace directory: ${workspacePath}

Question: ${question}`;
}
