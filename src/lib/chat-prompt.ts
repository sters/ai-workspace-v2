/**
 * Build the initial prompt sent to Claude when starting an interactive chat session.
 */
export function buildInitPrompt(workspaceId: string, workspacePath: string): string {
  return `You are working on the workspace "${workspaceId}".
The workspace directory is: ${workspacePath}
This workspace is managed by ai-workspace. The workspace directory contains README.md (workspace overview and plan), TODO files (task tracking), and review artifacts.

Please start by reading the workspace README.md to understand the current state and goals, then let me know what you find.`;
}
