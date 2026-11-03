/**
 * Prompt template for the acceptance-criteria feasibility check.
 *
 * Runs once per autonomous run, before the first cycle. The README clarity gate
 * next door asks whether the contract is *clear*; this asks whether it is
 * *achievable inside these repositories*. A criterion can be perfectly clear,
 * perfectly grounded in the request, and still impossible — the usual shape is a
 * cross-repo one, where satisfying it needs a schema or API change another team
 * owns.
 *
 * Such a criterion is expensive precisely because nothing detects it: the README
 * verifier reports it UNSATISFIED every cycle, the reviewers re-derive why every
 * cycle, and the gate keeps looping toward a target no cycle can reach. Findings
 * recorded here land in the known-findings ledger, which is what makes the rest
 * of the pipeline stop chasing them.
 *
 * Unlike the clarity gate this never stops the run — it annotates the contract
 * and lets the cycles proceed on the part that is achievable.
 */

import type { CriteriaFeasibilityInput } from "@/types/prompts";
import { NO_CD_RULES, REPO_SEARCH_EFFICIENCY, STOP_WHEN_ANSWERED } from "./shared";

/** Phase label (set in `src/lib/pipelines/autonomous.ts`). */
export const CRITERIA_FEASIBILITY_PHASE_LABEL = "Check criteria feasibility";

export const CRITERIA_FEASIBILITY_SCHEMA = {
  type: "object",
  properties: {
    infeasible: {
      type: "array",
      description:
        "The (auto) acceptance criteria that cannot be satisfied by any change within these repositories. Empty when all of them are achievable.",
      items: {
        type: "object",
        properties: {
          criterion: {
            type: "string",
            description: "The acceptance criterion, quoted closely enough to identify it.",
          },
          reason: {
            type: "string",
            description:
              "The concrete blocker — name the file, symbol, schema or owner that would have to change, and why it is outside these repositories.",
          },
        },
        required: ["criterion", "reason"],
        additionalProperties: false,
      },
    },
    reason: {
      type: "string",
      description: "One or two sentences summarizing the verdict.",
    },
  },
  required: ["infeasible", "reason"],
  additionalProperties: false,
} as const;

export function getCriteriaFeasibilitySystemPrompt(): string {
  return `You are the acceptance-criteria feasibility check for an autonomous coding workflow. The workspace README defines "done" as a list of acceptance criteria, and the run is about to implement them with no further human input. Your job is to identify criteria that **no change within this workspace's repositories can satisfy**, before the run spends its cycles trying.

A separate check already decided the README is clear enough to implement. You are not re-judging clarity, wording, or scope — only achievability against the code as it actually exists.

**Read-only.** You read code and report; you edit nothing and run only read-only \`git\` commands (\`diff\`, \`log\`, \`show\`, \`status\`).

### What you are checking

Only \`(auto)\` criteria. \`(manual)\` criteria are human handoffs by design — visual QA, staging sign-off, a decision from a spec owner — and are never your concern.

For each \`(auto)\` criterion, answer one question: is there a change **within these repositories** that would satisfy it?

Per criterion, find the module that would change. If within a few lookups you find no file owned outside the listed worktrees that blocks it, it is feasible — move on to the next.

Read only inside the listed worktrees. A vendored or generated contract file there (a checked-in schema, proto, or generated client) is the evidence for what the upstream carries — do not look past it to upstream repositories, module caches or the network.

### Infeasible — report it

- Satisfying it requires a change to something these repositories do not own: another team's schema, proto, API response shape, database, or external service. The classic case is a criterion about data the upstream contract does not carry, or carries in a shape that loses the information (a repeated field collapsed to a single value, a field that is not exposed at all).
- The data it describes does not exist anywhere reachable from this code.
- It contradicts a constraint the repositories themselves document (or the README's \`## Repository Constraints\`), so satisfying one half necessarily breaks the other.

For each, name the concrete blocker: the file, symbol, or schema that would have to change, and why it sits outside these repositories.

### NOT infeasible — leave it alone

- Merely hard, large, or unstarted work. Nothing is implemented yet; that is the point of the run.
- Work needing a refactor, a new test, a new file, or a new dependency inside these repositories.
- Something you could not confirm either way within those few lookups.
- A conflict with the README's \`## Non-Goal\` or \`## Assumptions\`. That is a contract question the clarity check owns, not a blocker in the code.

### When unsure, treat it as feasible

The asymmetry matters. A wrong "infeasible" silently deletes real work from the run — the gate stops looping toward it and the PR ships without it, with a recorded justification that looks authoritative. A wrong "feasible" costs nothing but the normal review-and-gate loop that would have run anyway. Report a criterion only when you can point at the blocker.

An empty \`infeasible\` list is the expected, healthy result.

${STOP_WHEN_ANSWERED}

${NO_CD_RULES}

${REPO_SEARCH_EFFICIENCY}

### Language

- Always write \`criterion\` and \`reason\` in English.

### Output

Respond with a JSON object matching the schema. Be concise.`;
}

export function buildCriteriaFeasibilityPrompt(input: CriteriaFeasibilityInput): string {
  const repoSection = input.repos.length > 0
    ? input.repos.map((r) => `- **${r.repoName}**: \`${r.worktreePath}\``).join("\n")
    : "(no repositories on disk)";

  return `# Acceptance Criteria Feasibility Check: ${input.workspaceName}

Decide which \`(auto)\` acceptance criteria below cannot be satisfied by any change within the repositories listed. Read only inside these worktrees.

## Repositories

${repoSection}

## README Content

${input.readmeContent}
${input.acceptanceCriteria ? `\n## Acceptance Criteria (parsed)\n\n${input.acceptanceCriteria}\n` : ""}`;
}
