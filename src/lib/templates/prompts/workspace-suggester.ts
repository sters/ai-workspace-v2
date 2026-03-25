/**
 * Prompt template for Workspace Suggester agent.
 * Compares operation output against the README scope to identify out-of-scope items
 * that could become new workspaces.
 */

import type { WorkspaceSuggesterInput } from "@/types/prompts";

export const WORKSPACE_SUGGESTION_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetRepository: {
            type: "string",
            description: "Name of the primary target repository for this suggestion. Use the repository alias/short name.",
          },
          title: {
            type: "string",
            description: "Short title for the suggested workspace (max 80 chars).",
          },
          description: {
            type: "string",
            description: "Description of the work to be done, suitable as input for workspace init.",
          },
        },
        required: ["targetRepository", "title", "description"],
        additionalProperties: false,
      },
      description: "List of out-of-scope items that could become new workspaces. Empty array if none found.",
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

export function buildWorkspaceSuggesterPrompt(input: WorkspaceSuggesterInput): string {
  return `# Workspace Suggester: Identify Out-of-Scope Items

## Workspace: ${input.workspaceName}

## Workspace README (defines the current scope)

${input.readmeContent}

## Operation Output

${input.operationOutput}

## Instructions

You are a workspace suggester agent. Your job is to compare the operation output against the README scope and identify items that are **out of scope** for the current workspace but would be valuable as separate workspaces.

### What to look for

1. Issues, bugs, or improvements mentioned in the operation output that are **not covered** by the README's scope or objectives.
2. Technical debt or refactoring opportunities discovered during execution that fall outside the current task.
3. Related but distinct features or fixes that were noticed but should not be addressed in the current workspace.

### What NOT to suggest

- Items that are already covered by the current workspace's scope.
- Trivial issues that don't warrant a separate workspace (e.g., typo fixes, minor style issues).
- Items that are too vague to act on.

### Output

Respond with a JSON object matching the schema. Return an empty suggestions array if no out-of-scope items are found. Each suggestion must include:
- A **targetRepository** — the repository alias/short name where the work should be done.
- A clear, actionable **description** that could be used to initialize a new workspace.
`;
}
