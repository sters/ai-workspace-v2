/**
 * Prompt template for Autonomous Gate agent.
 * Evaluates review results to decide whether to loop (fix issues) or proceed to PR creation.
 */

import type { AutonomousGateInput } from "@/types/prompts";

export const AUTONOMOUS_GATE_SCHEMA = {
  type: "object",
  properties: {
    shouldLoop: {
      type: "boolean",
      description: "Whether to loop back for another Execute cycle to fix issues.",
    },
    reason: {
      type: "string",
      description: "Brief explanation of the decision.",
    },
    fixableIssues: {
      type: "array",
      items: { type: "string" },
      description: "List of fixable issues to address in the next iteration (empty if shouldLoop is false).",
    },
  },
  required: ["shouldLoop", "reason", "fixableIssues"],
  additionalProperties: false,
};

export function buildAutonomousGatePrompt(input: AutonomousGateInput): string {
  const reviewFilesSection = input.reviewFiles.length > 0
    ? input.reviewFiles
        .map((f) => `### ${f.name}\n\n${f.content}`)
        .join("\n\n")
    : "(no review files)";

  const todoFilesSection = input.todoFiles.length > 0
    ? input.todoFiles
        .map((f) => `### TODO-${f.repoName}.md\n\n${f.content}`)
        .join("\n\n")
    : "(no TODO files)";

  return `# Autonomous Gate: Evaluate Review Results

## Loop Iteration: ${input.loopIteration} / ${input.maxLoops}

## Workspace: ${input.workspaceName}

## Workspace README

${input.readmeContent}

## Review Summary (SUMMARY.md)

${input.reviewSummary}

## Review Detail Files

${reviewFilesSection}

## TODO Files

${todoFilesSection}

## Instructions

You are an autonomous gate agent. Your job is to evaluate the review results and decide whether to loop back for another Execute cycle to fix issues, or proceed to PR creation.

### Decision Criteria

1. Examine each critical or major issue in the review results.
2. For each issue, determine if it is **fixable within the scope of the TODO items** — i.e., the issue relates to code that was changed or should have been changed as part of the TODO tasks.
3. Issues that are pre-existing, out-of-scope, or require architectural decisions beyond the TODO scope should NOT trigger a loop.

### Decision Rules

- If there are **fixable in-scope issues**: set \`shouldLoop: true\` and list the specific issues in \`fixableIssues\`.
- If there are **no fixable in-scope issues** (all issues are out-of-scope or pre-existing): set \`shouldLoop: false\`.
- If the review found **no critical or major issues**: set \`shouldLoop: false\`.
${input.loopIteration >= input.maxLoops ? "\n**NOTE: This is the final iteration. You MUST set `shouldLoop: false` regardless of issues found.**\n" : ""}
### Output

Respond with a JSON object matching the schema. Be concise in your reason.
`;
}
