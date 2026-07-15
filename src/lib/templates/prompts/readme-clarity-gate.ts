/**
 * Prompt template for the README clarity gate.
 *
 * Runs once in autonomous mode right after the README is drafted, BEFORE any
 * execution. It decides whether the drafted README is a clear enough "done"
 * contract to implement autonomously. When it is not, the autonomous run stops
 * and recommends the human refine the README (update-readme) rather than
 * barreling ahead against a vague or fabricated contract.
 */

import type { ReadmeClarityGateInput } from "@/types/prompts";

/** Phase label for the clarity gate (set in `src/lib/pipelines/autonomous.ts`).
 * Shared so the Slack notifier can locate the gate's result event. */
export const README_CLARITY_PHASE_LABEL = "Analyze README clarity";

/** Prefix of the `emitResult` message the clarity gate emits when it STOPS the
 * run. The Slack notifier matches on this to relay the stop reason instead of
 * the default "no PRs created" message. Keep in sync with the emit site. */
export const README_CLARITY_STOP_PREFIX =
  "**Stopping: the drafted README is too unclear to implement autonomously.**";

export const README_CLARITY_GATE_SCHEMA = {
  type: "object",
  properties: {
    sufficient: {
      type: "boolean",
      description:
        "true if the README is clear and grounded enough to implement autonomously without a human clarifying it first; false if it is too vague, contradictory, or fabricated to safely proceed.",
    },
    reason: {
      type: "string",
      description: "One or two sentences explaining the decision.",
    },
    missing: {
      type: "array",
      items: { type: "string" },
      description:
        "When sufficient is false, the specific gaps a human should resolve (empty when sufficient is true).",
    },
  },
  required: ["sufficient", "reason", "missing"],
  additionalProperties: false,
} as const;

export function getReadmeClarityGateSystemPrompt(): string {
  return `You are the README clarity gate for an autonomous coding workflow. A README has just been drafted from a user's request, and the system is about to implement it end-to-end with NO further human input. Your job is to decide whether the README is a clear, grounded enough "done" contract to safely proceed, or whether it is so unclear that the run should stop and ask the human to refine it.

You are a **safety valve, not a quality bar.** Autonomous mode is expected to make reasonable judgment calls and fill small gaps on its own. Only block when proceeding would mean building against a target that is genuinely unknown or fabricated — where any implementation would be a guess about what the user actually wants.

### Set \`sufficient: false\` (stop and recommend refining the README) when:

- **The Goal is empty, a placeholder, or too vague to act on** (e.g. still contains template comments like "<!-- ... -->", "TBD", or a one-liner that could mean many different things).
- **There are no actionable Acceptance Criteria** an implementer could build toward — no \`(auto)\` criteria at all, or the only criteria are \`(manual)\` handoffs, leaving nothing concrete to implement/verify.
- **The core scope rests on guesses.** The \`## Assumptions\` section (or the criteria themselves) invent the substance of what to build rather than deriving it from the request — i.e. a human reading it could not confirm this is what was actually asked for.
- **Requirements are internally contradictory** or so underspecified that a competent engineer could not tell what "done" means.

### Set \`sufficient: true\` (proceed) when:

- The Goal is concrete and there is at least one grounded, actionable \`(auto)\` acceptance criterion, even if some details are left to reasonable judgment.
- Gaps are minor and an engineer could fill them sensibly without changing what the user asked for.

Bias toward \`true\` for normal, reasonably-specified tasks. Reserve \`false\` for READMEs that are genuinely too thin or speculative to implement — the cost of a false stop is a human nudge, but the cost of a false proceed is a confidently-wrong autonomous run.

### Language

- Always write \`reason\` and \`missing\` in English.

### Output

Respond with a JSON object matching the schema. Be concise.`;
}

export function buildReadmeClarityGatePrompt(input: ReadmeClarityGateInput): string {
  return `# README Clarity Gate: ${input.workspaceName}

Decide whether the drafted README below is clear and grounded enough to implement autonomously, or whether the run should stop and ask the human to refine it.

## README Content

${input.readmeContent}
${input.acceptanceCriteria ? `\n## Acceptance Criteria (parsed)\n\n${input.acceptanceCriteria}\n` : ""}`;
}
