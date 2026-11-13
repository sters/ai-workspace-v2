/**
 * Prompt template for the README follow-up judge.
 *
 * Runs as the last phase of `update-readme`. It compares the README before and
 * after the update against the TODO files and decides what the workspace needs
 * next: re-planning the TODOs (`update-todo`), running the implementation loop
 * (`autonomous`), both, or nothing. `update-readme` starts the chosen follow-up
 * once it completes.
 */

import type { ReadmeFollowUpInput } from "@/types/prompts";

export const README_FOLLOW_UP_PHASE_LABEL = "Decide follow-up";

export const README_FOLLOW_UP_SCHEMA = {
  type: "object",
  properties: {
    updateTodo: {
      type: "boolean",
      description:
        "true if the README change makes the existing TODO items wrong, incomplete or obsolete, so the TODOs must be re-planned before more work is done.",
    },
    autonomous: {
      type: "boolean",
      description:
        "true if the README change leaves implementation work the code does not yet do, so the execute → review loop should run.",
    },
    reason: {
      type: "string",
      description: "One or two sentences naming the change that drove the decision.",
    },
  },
  required: ["updateTodo", "autonomous", "reason"],
  additionalProperties: false,
} as const;

export function getReadmeFollowUpSystemPrompt(): string {
  return `You decide what a workspace needs after its README was updated. The README is the workspace's "done" contract: Goal, Non-Goal, Assumptions, Requirements and Acceptance Criteria. The TODO files are the per-repository plan derived from it. You are shown the README before and after the update, the instruction that drove the update, and the current TODO files.

Decide from the text in the prompt only: do not read files, run commands, or edit anything.

### \`updateTodo\`

\`true\` when the plan no longer matches the contract — the premise moved. Examples (non-exhaustive):

- A requirement or \`(auto)\` acceptance criterion was added, removed or changed in substance.
- An assumption or a Non-Goal changed what gets built, which approach is taken, or which repository does the work.
- A repository was added to or removed from the README.
- TODO items implement something the README now excludes, or nothing in the TODOs covers something it now requires.

\`false\` when the plan still holds: wording, formatting, typo fixes, added background or links, a clarification that confirms what the TODOs already do, or a change confined to \`(manual)\` criteria.

When there are no TODO files yet, set \`updateTodo: false\`; the implementation loop plans missing TODOs itself.

### \`autonomous\`

\`true\` when the updated contract asks for implementation work that is not finished — either because \`updateTodo\` is \`true\`, or because the TODO files still have pending (\`[ ]\`) or in-progress (\`[~]\`) items.

\`false\` when the change needs no code change and the TODOs show nothing left to implement, or when the update only records a decision for people (scope notes, a \`(manual)\` handoff).

### Language

- Always write \`reason\` in English.

### Output

Respond with a JSON object matching the schema. Be concise.`;
}

export function buildReadmeFollowUpPrompt(input: ReadmeFollowUpInput): string {
  const todoSection = input.todos.length > 0
    ? input.todos.map((t) => `### ${t.filename}\n\n${t.content}`).join("\n\n")
    : "(no TODO files)";

  return `# README Follow-up: ${input.workspaceName}

## Update instruction

${input.instruction}

## README before the update

${input.previousReadme || "(empty)"}

## README after the update

${input.currentReadme || "(empty)"}

## TODO files

${todoSection}
`;
}
