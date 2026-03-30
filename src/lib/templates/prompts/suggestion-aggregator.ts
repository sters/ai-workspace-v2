/**
 * Prompt template for Suggestion Aggregator.
 * Reviews all active suggestions and merges similar ones into consolidated entries.
 */

import type { SuggestionAggregatorInput } from "@/types/prompts";

export const SUGGESTION_AGGREGATION_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mergedIds: {
            type: "array",
            items: { type: "string" },
            description:
              "IDs of the original suggestions merged into this group. Must contain at least 2 IDs.",
          },
          targetRepository: {
            type: "string",
            description:
              "Primary target repository for the merged suggestion.",
          },
          title: {
            type: "string",
            description:
              "Consolidated title for the merged suggestion (max 80 chars).",
          },
          description: {
            type: "string",
            description:
              "Consolidated description combining the intent of all merged suggestions. Suitable as input for workspace init.",
          },
        },
        required: ["mergedIds", "targetRepository", "title", "description"],
        additionalProperties: false,
      },
      description:
        "Groups of similar suggestions merged into single entries. Only include groups of 2+ suggestions.",
    },
    unchangedIds: {
      type: "array",
      items: { type: "string" },
      description:
        "IDs of suggestions that are unique and should remain as-is.",
    },
  },
  required: ["groups", "unchangedIds"],
  additionalProperties: false,
};

export function buildSuggestionAggregatorPrompt(
  input: SuggestionAggregatorInput,
): string {
  const items = input.suggestions
    .map(
      (s) =>
        `- **ID:** \`${s.id}\`\n  **Repo:** ${s.targetRepository || "(unknown)"}\n  **Title:** ${s.title}\n  **Description:** ${s.description}`,
    )
    .join("\n\n");

  return `# Aggregate Similar Suggestions

You are given ${input.suggestions.length} workspace suggestions. Your task is to identify groups of similar suggestions and merge each group into a single, consolidated suggestion.

## Rules

1. Only merge suggestions that are clearly about the same topic, feature, or bug in the same (or closely related) repository.
2. Each merged group must contain **at least 2** original suggestion IDs in \`mergedIds\`.
3. The merged title and description should combine the intent of all merged suggestions into one clear, actionable entry.
4. Suggestions that have no close match must be listed in \`unchangedIds\`.
5. Every original suggestion ID must appear exactly once — either in one \`mergedIds\` array or in \`unchangedIds\`.
6. **Always write all output (titles, descriptions) in English.**

## Suggestions

${items}
`;
}
