/**
 * Prompt template for Suggestion Pruner.
 * Checks whether each suggestion has already been addressed in its target repository.
 */

import type { SuggestionPrunerInput } from "@/types/prompts";

export const SUGGESTION_PRUNE_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The suggestion ID.",
          },
          resolved: {
            type: "boolean",
            description:
              "True if the suggestion has already been addressed in the repository.",
          },
          reason: {
            type: "string",
            description:
              "Brief explanation of why the suggestion is or is not resolved (max 200 chars).",
          },
        },
        required: ["id", "resolved", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export function buildSuggestionPrunerPrompt(
  input: SuggestionPrunerInput,
): string {
  const items = input.suggestions
    .map(
      (s) =>
        `- **ID:** \`${s.id}\`\n  **Title:** ${s.title}\n  **Description:** ${s.description}`,
    )
    .join("\n\n");

  return `# Check If Suggestions Are Already Resolved

You are working inside the repository at \`${input.repoPath}\`.

Below are ${input.suggestions.length} suggestion(s) that were previously identified as out-of-scope work items for this repository. Your task is to determine whether each suggestion has **already been addressed** in the current state of the repository.

## How to check

1. Use \`git log\` to review recent commits for changes related to the suggestion.
2. Read relevant source files to verify the described work is done.
3. A suggestion is **resolved** if the described feature, fix, or improvement is already implemented, merged, or otherwise no longer needed.
4. A suggestion is **not resolved** if the work is still pending, only partially done, or there is no evidence it was addressed.

## Rules

1. Every suggestion ID must appear exactly once in the \`results\` array.
2. Be conservative: only mark a suggestion as \`resolved: true\` if you have clear evidence.
3. Keep the \`reason\` concise (max 200 chars).
4. **Always write all output in English.**

## Suggestions

${items}
`;
}
