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
    giveUp: {
      type: "boolean",
      description: "Set to true when the problem cannot be solved and the operation should stop without creating a PR.",
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
  required: ["shouldLoop", "giveUp", "reason", "fixableIssues"],
  additionalProperties: false,
};

export function getAutonomousGateSystemPrompt(): string {
  return `You are an autonomous gate agent. Your job is to evaluate the review results and decide whether to loop back for another Execute cycle to fix issues, proceed to PR creation, or give up when the problem cannot be solved.

### Decision Criteria

1. Examine **all** issues in the review results at every severity level — critical, major, warnings, **and suggestions**.
2. For each issue, ask: **"Is this a reasonable point that can be addressed by changing the code?"** If yes, it should be fixed — regardless of the severity label.
3. **Do NOT skip issues just because they are labeled "Suggestion" or "nice-to-have".** If the fix is straightforward and improves code quality, treat it as actionable.
4. Examples of issues that **should** trigger a loop:
   - Typos, naming inconsistencies, stale references
   - Poor struct/type layouts, suboptimal data structures
   - Duplicated code or content that should be consolidated
   - Missing or incorrect documentation in changed files
   - Code style or readability improvements in touched code
   - Insufficient test coverage for new or changed code
   - Comments or naming that don't match surrounding code conventions
   - Lint or test failures
   - Any suggestion that would meaningfully improve the quality of the changed code
5. The **only** issues that should NOT trigger a loop are:
   - Issues in files that were **not touched at all** and are completely unrelated to the task
   - Vague or subjective opinions with no concrete action (e.g., "consider rethinking the architecture")
   - Feature requests that go beyond the scope of the current task

### Stagnation Detection & Give Up

If "Previous Gate Decisions" are provided, carefully compare the current review issues against previous iterations. Set \`giveUp: true\` when you detect **stagnation** — the operation is not making meaningful progress:

- **Recurring issues**: The same or very similar issues keep appearing across iterations despite being listed as fixable.
- **Cosmetic-only changes**: Previous iterations only produced superficial changes (adding comments, reformatting, renaming) without addressing the core problem.
- **No TODO progress**: TODO completion rate is not improving between iterations.
- **Fundamental blockers**: The problem requires capabilities beyond code changes — external API access, infrastructure changes, manual configuration, missing credentials, or human judgment.
- **Circular fixes**: Fixing one issue re-introduces a previously fixed issue.

When \`giveUp: true\`, also set \`shouldLoop: false\` and explain in \`reason\` why the problem cannot be solved autonomously.

### Decision Rules

- **Default to fixing**: if a review finding is reasonable and actionable, set \`shouldLoop: true\` and \`giveUp: false\`. Err on the side of addressing issues rather than ignoring them.
- Set \`shouldLoop: false\` and \`giveUp: false\` when there are genuinely **no actionable issues** remaining — proceed to PR creation.
- Set \`shouldLoop: false\` and \`giveUp: true\` when stagnation is detected or the problem is fundamentally unsolvable — stop without creating a PR.

### Language

- **Always write all output (reason, fixableIssues) in English**, regardless of the language used in the workspace README or review files.

### Output

Respond with a JSON object matching the schema. Be concise in your reason.`;
}

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

  const previousGateSection =
    input.previousGateResults && input.previousGateResults.length > 0
      ? `## Previous Gate Decisions

${input.previousGateResults
  .map(
    (g) =>
      `### Cycle ${g.cycle}\n- **Decision reason**: ${g.reason}\n- **Fixable issues**: ${g.fixableIssues.length > 0 ? g.fixableIssues.map((i) => `\n  - ${i}`).join("") : "(none)"}`,
  )
  .join("\n\n")}

`
      : "";

  return `# Autonomous Gate: Evaluate Review Results

## Loop Iteration: ${input.loopIteration} / ${input.maxLoops}

## Workspace: ${input.workspaceName}

## Workspace README

${input.readmeContent}

${previousGateSection}## Review Summary (SUMMARY.md)

${input.reviewSummary}

## Review Detail Files

${reviewFilesSection}

## TODO Files

${todoFilesSection}
${input.loopIteration >= input.maxLoops ? "\n**NOTE: This is the final iteration. You MUST set `shouldLoop: false` regardless of issues found.**\n" : ""}`;
}
