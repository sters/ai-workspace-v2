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

1. Examine **all** issues in the review results at every severity level — critical, major, warnings, and suggestions.
2. For each issue, ask: **"Is this a reasonable point that can be addressed by changing the code?"** If yes, it should be fixed.
3. Examples of issues that **should** trigger a loop:
   - Typos, naming inconsistencies, stale references
   - Poor struct/type layouts, suboptimal data structures
   - Duplicated code or content that should be consolidated
   - Missing or incorrect documentation in changed files
   - Code style or readability improvements in touched code
   - Any suggestion that would meaningfully improve the quality of the changed code
4. The **only** issues that should NOT trigger a loop are:
   - Issues in files that were **not touched at all** and are completely unrelated to the task
   - Vague or subjective opinions with no concrete action (e.g., "consider rethinking the architecture")
   - Feature requests that go beyond the scope of the current task

### Decision Rules

- **Default to fixing**: if a review finding is reasonable and actionable, set \`shouldLoop: true\`. Err on the side of addressing issues rather than ignoring them.
- Only set \`shouldLoop: false\` when there are genuinely **no actionable issues** remaining.
${input.loopIteration >= input.maxLoops ? "\n**NOTE: This is the final iteration. You MUST set `shouldLoop: false` regardless of issues found.**\n" : ""}
### Output

Respond with a JSON object matching the schema. Be concise in your reason.
`;
}
