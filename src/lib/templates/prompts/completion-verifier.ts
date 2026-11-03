/**
 * The completion verifier: one agent per repository that checks both halves of
 * "was the planned work done" — the README's requirements and the TODO items —
 * against the code. Both halves read the same diff and the same files, which is
 * why they are one agent. Its verdict is structured
 * (`COMPLETION_VERIFICATION_SCHEMA`); the review pipeline renders the reports
 * and computes every count from it.
 */

import type { CompletionVerifierInput } from "@/types/prompts";
import { REPO_SEARCH_EFFICIENCY, worktreeCdRules } from "./shared";

export const COMPLETION_VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      description: "One entry per requirement verified: every Acceptance Criteria checkbox, plus any requirement from the README or a linked ticket the checkboxes do not already cover.",
      items: {
        type: "object",
        properties: {
          requirement: { type: "string", description: "The requirement, worded closely enough to locate it in the README." },
          kind: { type: "string", enum: ["auto", "manual"], description: "The criterion's tag; untagged counts as `auto`." },
          status: { type: "string", enum: ["SATISFIED", "PARTIAL", "UNSATISFIED", "PENDING-HUMAN"] },
          evidence: { type: "string", description: "`file:line`, test name or report line backing the status; for PARTIAL / UNSATISFIED, what is missing and where you looked." },
          notes: { type: "string" },
        },
        required: ["requirement", "kind", "status", "evidence"],
        additionalProperties: false,
      },
    },
    todoItems: {
      type: "array",
      description: "One entry per TODO item, in file order. Empty when no TODO file is given.",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "The item, quoted closely enough to locate it." },
          status: { type: "string", enum: ["VERIFIED", "UNVERIFIED", "PARTIAL", "INCOMPLETE", "UNMARKED", "SKIPPED"] },
          evidence: { type: "string" },
        },
        required: ["item", "status", "evidence"],
        additionalProperties: false,
      },
    },
    recommendations: { type: "array", items: { type: "string" }, description: "Concrete next steps for what is not done. Empty when everything is." },
  },
  required: ["requirements", "todoItems", "recommendations"],
  additionalProperties: false,
} as const;

export function getCompletionVerifierSystemPrompt(): string {
  return `You verify that a branch did the work it set out to do. Two lists define that work — the workspace README's requirements and, when one exists, the repository's TODO file — and you check each entry on both against the code.

**Scope: completion, not quality.** Whether the code is good is a separate reviewer's job, running alongside you. Report whether each requirement and item was done, with evidence; leave design, style and defects out.

### Requirements (from the README)

- The \`## Acceptance Criteria\` section is the **authoritative** list of what "done" means. When a parsed list is given in the user prompt, use it verbatim. Fold in \`## Goal\` / \`## Requirements\` only where they add a check the criteria do not already cover.
- **Linked resources**: fetch links that likely define work — tickets, issue comments, PR review comments — and add any requirement they hold that the README lacks. Skip purely informational links (designs, documentation).
- **\`(auto)\` / \`(manual)\` tags** (untagged ⇒ \`auto\`): verify \`auto\` criteria yourself. A \`manual\` criterion needs a human (visual QA, staging sign-off); it is \`PENDING-HUMAN\`, a handoff rather than a failure — never \`UNSATISFIED\`.
- **Constraint results come from the report, not a re-run.** A criterion phrased as "lint / test / build / typecheck passes" is answered by the constraint report named in the user prompt, written by a phase that ran every declared command and compared failures against the merge-base. Cite it. A command it marks \`PRE-EXISTING\` also fails on the merge-base, so the criterion is \`PARTIAL\` with that as the reason; \`NOT DECLARED\` means nothing ran — say so. Running one narrow test to confirm a specific behavior is fine; re-running the declared set is not.
- Status: \`SATISFIED\` (fully met, with evidence), \`PARTIAL\` (say what is missing), \`UNSATISFIED\` (no evidence it was addressed), \`PENDING-HUMAN\` (manual).

### TODO items

- Checked (\`[x]\`): \`VERIFIED\` when the change is there, \`UNVERIFIED\` when it is marked done without evidence, \`PARTIAL\` when part of it is.
- Unchecked (\`[ ]\`): \`INCOMPLETE\` when not done, \`UNMARKED\` when done anyway, \`SKIPPED\` when the file records it as deliberately dropped.
- Blocked (\`[!]\`) items are waiting on a human: report them \`INCOMPLETE\` with the recorded question as evidence.

### Gathering evidence

The changed files, diff stat and commit log are in the user prompt. Read the actual change with \`git diff\` (not \`--stat\` / \`--name-only\` / \`log\`, which you already have) only where an entry needs it. One look at a file usually settles several entries — the requirements and the TODO items describe the same work, so check them together rather than in two passes.

${REPO_SEARCH_EFFICIENCY}

${worktreeCdRules({
  examples: "`git diff` (for specific file content)",
  extra: "Do NOT re-run `git log` or `git diff --stat` / `--name-only` — those are already provided in the user prompt.",
})}

### Output

Respond with a JSON object matching the schema, in English whatever the README's language. Keep each \`evidence\` to a line or two: a path and line beats a paragraph. Do not compute totals or rates — they are derived from your entries.`;
}

export function buildCompletionVerifierPrompt(input: CompletionVerifierInput): string {
  return `# Task: Verify completion for ${input.repoName}

## Workspace: ${input.workspaceName}
## Repository: ${input.repoPath}
## Base Branch: ${input.baseBranch}
## Worktree: ${input.worktreePath}

## README Content

${input.readmeContent}
${input.acceptanceCriteria ? `\n## Acceptance Criteria (parsed — verify these)\n\n${input.acceptanceCriteria}\n` : ""}
## TODO File${input.todoContent ? ` (TODO-${input.repoName}.md)\n\n${input.todoContent}` : "\n\n(none — return an empty `todoItems`)"}

## Repository Changes

${input.repoChanges}

## Constraint Verification Report (already run — read, do not re-run)

${input.constraintReportPath}

### Working Directory

\`\`\`bash
cd ${input.worktreePath}
\`\`\`
`;
}
