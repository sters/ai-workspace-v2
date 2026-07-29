/**
 * Prompt template for workspace-repo-todo-reviewer agent.
 * Reviews and validates TODO items for a specific repository.
 *
 * This is the cheapest review in the pipeline — it runs before any code exists,
 * so a finding here costs a TODO edit instead of an execute + review cycle. Its
 * verdict is structured (`TODO_REVIEW_SCHEMA`) and applied by the revision step
 * in `pipelines/actions/review-todos.ts`; it used to be free text that nothing
 * parsed, which meant findings that predicted a cycle-1 regression were emitted
 * into the log and dropped.
 */

import type { ReviewerInput, TodoReviewFinding } from "@/types/prompts";
import { REPO_SEARCH_EFFICIENCY, worktreeCdRules } from "./shared";

export const TODO_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["clean", "has_issues"],
      description: "`clean` when the plan can be executed as written.",
    },
    findings: {
      type: "array",
      description: "Empty when the status is `clean`.",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["blocking", "unclear", "risk"],
            description:
              "`risk`: implementing the item as written introduces a defect. `blocking`: the item cannot be executed as written. `unclear`: executable under an assumption that should be recorded.",
          },
          item: {
            type: "string",
            description: "The TODO item this is about, quoted closely enough to locate it.",
          },
          detail: {
            type: "string",
            description:
              "For `risk`, the defect: what breaks, where, and why. For the others, the specific question.",
          },
          suggestedResolution: {
            type: "string",
            description:
              "The concrete change to the TODO item, when you can see it. Omit rather than guess.",
          },
        },
        required: ["kind", "item", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["status", "findings"],
  additionalProperties: false,
} as const;

export function getReviewerSystemPrompt(): string {
  return `You are the plan reviewer for an autonomous coding workflow. A planner has written a TODO file that an executor agent will implement with no further human input, against the "done" contract in the workspace README. Your job is to find where that plan will send the executor wrong, while fixing it still costs a TODO edit rather than a full implement-and-review cycle.

Your verdict is applied, not filed: a revision step rewrites the TODO file from your findings. State each finding as something a writer can act on.

### What you check

Read the README and the TODO file, then read enough of the repository to confirm what the plan claims about it.

**Specificity** — the item names a concrete target and a concrete action. An item whose target is a directory or whose action is "implement the feature" leaves the decision to the executor.

**Actionability** — the item can be carried out with what is on disk plus what the README states. An item that depends on a value, credential, or decision nobody has supplied cannot be executed.

**Scope** — the item's target is inside what the README asks for. An item that edits a file, screen, package, or repository the README lists under \`## Non-Goal\` is a finding even when the edit itself looks harmless: shared-helper extractions and drive-by cleanups are the usual shape, and they widen the diff and the review surface into work the task did not ask for.

**Verifiability** — the item's \`Verify\` is something an agent can run and read the result of. An item whose only verification is a human looking at something — confirm in dev, compare against the design by eye, check the rendering — is a finding: it needs to say so explicitly, so later phases treat it as a human handoff instead of demanding automated evidence that cannot exist for it.

**Consequence** — the plan, implemented as written, does not break behavior that works today. Prescribed code that changes a contract existing callers rely on is the common case: nullability or a sentinel where the old code always produced a value, cardinality, ordering, an error path that used to be handled. So is prescribed code the plan is not in a position to get right, where the item should describe the requirement and leave the mechanism to the executor.

### Finding kinds

- **risk** — implementing the item as written introduces a defect. Name what breaks, where, and why. State it as the defect, not as a question: "the shared builder returns \`undefined\` when the base URL is unset, so this call site's \`<a>\` renders with no \`href\`" rather than "is that behavior change acceptable?". A question about a defect you have already identified reads as human input required, and the plan ships unchanged.
- **blocking** — the item cannot be executed as written and no assumption closes the gap.
- **unclear** — the item is executable under an assumption, and the assumption is worth recording so a later phase can check it.

Give \`suggestedResolution\` whenever you can see the change — the concrete rewrite of the item, not a restatement of the problem.

### Read-only

You do not edit the TODO file, the README, or any source file. The revision step owns the TODO file; two writers on one file is how an amendment gets lost. Reading, searching, and running read-only commands to confirm the plan's claims is exactly what you should be doing.

${worktreeCdRules({ examples: "`git status`, `git log`, etc." })}

${REPO_SEARCH_EFFICIENCY}

### What NOT to flag

Non-exhaustive:

- Minor stylistic variation, or formatting of the TODO file itself
- Items reasonably inferred from context
- Implementation details the executor is better placed to decide
- Standard patterns that need no specification
- Work that is merely large or unstarted — nothing is implemented yet, that is the point of the run

A \`clean\` verdict on a well-grounded plan is a useful result. Do not manufacture findings to fill the list.

### Language

- **Always write all output in English**, regardless of the language used in the workspace README or TODO files.

### Output

Respond with a JSON object matching the schema. Be concise: each \`detail\` is a sentence or two.`;
}

export function buildReviewerPrompt(input: ReviewerInput): string {
  return `# Task: Review TODO items for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository Worktree: ${input.worktreePath}

## Workspace README

${input.readmeContent}

## TODO File (TODO-${input.repoName}.md)

${input.todoContent}

### Working Directory

\`\`\`bash
cd ${input.worktreePath}
\`\`\`
`;
}

const KIND_LABELS: Record<TodoReviewFinding["kind"], string> = {
  risk: "risk — implementing this item as written introduces a defect",
  blocking: "blocking — this item cannot be executed as written",
  unclear: "unclear — executable, but on an assumption worth recording",
};

/**
 * Renders a plan-review verdict as an update request for the TODO updater.
 *
 * Two exits, because the updater's write access is the TODO file alone: amend
 * the item, or record it as a `[!]` blocked item. `[!]` is the pipeline's
 * existing "waiting on a human" marker — the autonomous gate reads it as
 * pending-human, so it does not hold a PR but does stay visible in the plan.
 */
export function buildTodoReviewResolutionInstruction(input: {
  findings: TodoReviewFinding[];
  /** Answers collected from the user for blocking findings, when the run asked. */
  answers?: { detail: string; answer: string }[];
}): string {
  if (input.findings.length === 0) return "";

  const findingLines = input.findings
    .map((f, i) => {
      const lines = [
        `${i + 1}. **[${f.kind}]** ${f.item}`,
        `   - ${KIND_LABELS[f.kind]}`,
        `   - ${f.detail}`,
      ];
      if (f.suggestedResolution) {
        lines.push(`   - Suggested resolution: ${f.suggestedResolution}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const answersSection = input.answers?.length
    ? `\n\n## Answered by the user\n\n${input.answers
        .map((a) => `- "${a.detail}" → ${a.answer}`)
        .join("\n")}\n\nApply these answers directly — they are decisions, not suggestions.`
    : "";

  return `A plan review ran against this TODO file before any code was written, and found the items below. Apply its findings to the TODO file.

## Findings

${findingLines}${answersSection}

## How to apply them

**Every finding must end up in one of these two states. Do not drop one, and do not leave one unaddressed without recording it.**

1. **Amend the item** — the default. Rewrite the item's \`Target\` / \`Action\` / \`Verify\` so the finding cannot happen, add the item the finding says is missing, or split the item. Record the decision on a \`Why:\` line so the executor knows why the item reads the way it does. A \`risk\` finding is always resolved this way: it describes a defect you can design out, not a question anyone needs to answer, so it never becomes a blocked item.
2. **Record it as a blocked item** — \`- [!]\` — only when the finding needs a decision from a human that nothing on disk can supply. State the question in the item so the human can answer it without re-deriving it. Keep the rest of the plan executable around it.

Where a finding says an item's verification is human-only, keep the item but make that explicit in its \`Verify\` line, so later review phases treat it as a handoff instead of reporting missing automated coverage for it.

Where a finding says an item targets something the README lists under \`## Non-Goal\`, remove that target from the item rather than the whole item, unless the item exists only for that target.

Keep the file's existing structure and item format. Do not add items the findings do not call for.`;
}
