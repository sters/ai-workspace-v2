/**
 * Prompt fragments shared across agent system prompts.
 *
 * Two kinds of things live here:
 *
 * 1. Conventions that MUST stay identical across agents (the working-directory
 *    rules), because the same wording drifting per-file is how one agent ends
 *    up told to `cd` and another told never to.
 * 2. Model-behavior calibrations that apply to a whole class of agents
 *    (deliverable length, subagent delegation, scope, review coverage). These
 *    follow Anthropic's Claude Opus 5 / Sonnet 5 prompting guidance; see
 *    CLAUDE.md's "Prompt conventions" section for the rationale.
 */

/**
 * Working-directory rules for agents that operate inside a single repository
 * worktree. The bare-`cd`-first requirement exists because the Bash sandbox
 * blocks `cd <dir> && ...` compound commands.
 */
export function worktreeCdRules(opts: {
  /** Example commands to run after the cd, e.g. "`git status`, `git diff`, etc." */
  examples: string;
  /** Prefix-flag forms to forbid. Defaults to "`git -C`". */
  forbidden?: string;
  /** Extra paragraph appended to the end of the section. */
  extra?: string;
}): string {
  const forbidden = opts.forbidden ?? "`git -C`";
  const extra = opts.extra ? `\n\n${opts.extra}` : "";
  return `### Working Directory

**IMPORTANT: Your first Bash tool call MUST be \`cd\` alone to change the working directory to the worktree path specified in the user prompt. Do NOT combine \`cd\` with any other command using \`&&\` or \`;\`.**

After that, run commands like ${opts.examples} as separate Bash calls. Do NOT use ${forbidden} — you are already in the repo directory.${extra}`;
}

/**
 * Working-directory rules for agents that span multiple directories (the
 * collector reads every repo's review files; the coordinator reads every
 * worktree), where a per-agent cwd would be meaningless.
 */
export const NO_CD_RULES = `### Working Directory Rules

**NEVER use \`cd\` in Bash commands. ALWAYS use path arguments or \`-C\` flags.**`;

/**
 * Length calibration for agents whose deliverable is a file on disk.
 * Reports are re-embedded verbatim into downstream prompts (the collector reads
 * every review, the autonomous gate reads every review AND every TODO file), so
 * padding here multiplies into later phases' context and cost.
 */
export const WRITTEN_DELIVERABLE_LENGTH = `### Report Length

Match the length of what you write to the substance you actually have. Keep the report template's structure, but do not pad it: no filler sections, no restating the diff or the input files back to the reader, no summary of a summary. When a section has nothing substantive, say so in one line rather than writing prose around it. Later phases consume these reports verbatim, so every padded paragraph is paid for again downstream.`;

/**
 * Delegation policy for agents that can spawn subagents. Without it, delegation
 * gets applied to small tasks, which multiplies cost and wall-clock for no gain,
 * and self-verification subagents duplicate work the agent already does.
 */
export const SUBAGENT_DELEGATION_POLICY = `### Delegation

Delegate to a subagent only for large tracks of work that are genuinely independent and parallelizable — e.g. a wide multi-file investigation you cannot finish in a handful of tool calls. Do NOT delegate work you can complete yourself, and do NOT use subagents to verify or double-check your own output (later pipeline phases already verify it). When one subagent is enough, use one rather than several, and keep spawn counts low.`;

/** Scope calibration: deliver the requested task, neither narrowed nor widened. */
export const SCOPE_DISCIPLINE = `### Scope

Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and finish the whole task rather than leaving stubs or placeholders. If the request looks mistaken or you see a better approach, note it in the TODO/Notes in one sentence and continue with the task as asked — do not quietly narrow, widen, or transform it. Stop short of actions clearly beyond what was asked.`;

/**
 * Finding-stage policy for review agents: report everything, let a later stage
 * filter. Claude follows "only report important issues" style instructions
 * faithfully, which drops real low-severity bugs; the pipeline already has
 * downstream filtering (the review summary and the autonomous gate), so
 * confidence belongs in the report as data rather than as a reporting threshold.
 */
export const REVIEW_COVERAGE_POLICY = `### Coverage, Not Filtering

Report every issue you find, including ones you are uncertain about and ones you consider low-severity. Your job at this stage is **coverage**, not filtering — the review summary and the autonomous gate rank and filter afterwards. It is better to surface a finding that later gets filtered out than to silently drop a real bug. Do not withhold nits either; file them as Suggestions. The only finding you should leave out is one you actively confirmed is NOT a problem.

Annotate every finding with a **Confidence** so the downstream filter can rank it:

- **high** — verified in the code; you can point at the concrete failure.
- **medium** — likely a real problem, but you could not fully confirm it.
- **low** — a suspicion worth checking; may turn out to be a false positive.

Write it inline with the finding (e.g. \`(Confidence: medium)\`). Confidence is independent of severity: a low-confidence Critical and a high-confidence Suggestion are both normal and both worth reporting.`;
