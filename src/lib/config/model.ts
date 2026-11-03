import type { ClaudeEffort, ClaudeModel } from "@/types/claude";
import { CLAUDE_MODELS } from "@/types/claude";
import type { OperationType } from "@/types/operation";
import type { StepType } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import { getConfig } from "./resolver";

/**
 * Code-level default model and `--effort` per step type — the lowest-priority
 * defaults, which config overrides. Both tables cover every `STEP_TYPES` value
 * (`effort.test.ts`), so a new step type has to pick a pairing.
 *
 * Pick each pairing from the published price list and from independent
 * benchmarks of cost per task against score (e.g. artificialanalysis.ai,
 * agentic-coding benchmarks first), weighed against what a wrong answer from
 * the step costs: the cheapest pairing whose score holds for that kind of work.
 * A smaller model at a higher effort is often both cheaper and stronger than a
 * larger one at `low`; compare across models, not only within one. Re-check
 * when models or prices change, and confirm a change on real runs in Run Costs.
 *
 * Currently that comes to:
 *   opus / medium — implementation, review and planning: the agentic-coding work
 *                   where a smaller model scores clearly lower.
 *   opus / high   — the autonomous gate: one short call whose wrong answer costs
 *                   a whole cycle.
 *   haiku / max   — checking claims and lists against code, where it scores
 *                   level with opus / medium on agentic coding at a fraction of
 *                   the cost.
 *   haiku / xhigh — bounded lookups and mechanics, where opus / low costs four
 *                   times as much for the same score.
 *   haiku / low   — reshaping text already handed over.
 *
 * The smaller models are pinned to full IDs because the CLI resolves the bare
 * `sonnet` and `haiku` aliases to a previous generation.
 */
export const STEP_DEFAULT_MODELS: Partial<Record<StepType, ClaudeModel>> = {
  [STEP_TYPES.ANALYZE_README]: "opus",
  [STEP_TYPES.PLAN_TODO]: "opus",
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "opus",
  [STEP_TYPES.EXECUTE]: "opus",
  [STEP_TYPES.CODE_REVIEW]: "opus",
  [STEP_TYPES.COORDINATE_TODOS]: "opus",
  [STEP_TYPES.RESEARCH]: "opus",
  [STEP_TYPES.UPDATE_TODO]: "opus",
  [STEP_TYPES.UPDATE_README]: "opus",
  [STEP_TYPES.RESOLVE_CONFLICTS]: "opus",
  [STEP_TYPES.SUGGEST_WORKSPACE]: "opus",
  // Its verdict reaches someone else's PR with nobody reading it first.
  [STEP_TYPES.GROUND_FINDING]: "opus",
  [STEP_TYPES.AUTONOMOUS_GATE]: "opus",

  [STEP_TYPES.VERIFY_COMPLETION]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.VERIFY_FIXES]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.REVIEW_TODOS]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.CRITERIA_FEASIBILITY]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.VALIDATE_PR_COMMENT]: CLAUDE_MODELS.HAIKU_5_5,

  [STEP_TYPES.DISCOVER_CONSTRAINTS]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.DISCOVER_GUIDANCE]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.README_CLARITY_GATE]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.DEEP_SEARCH]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.CREATE_PR]: CLAUDE_MODELS.HAIKU_5_5,

  [STEP_TYPES.PRUNE_SUGGESTIONS]: CLAUDE_MODELS.HAIKU_5_5,
  [STEP_TYPES.AGGREGATE_SUGGESTIONS]: CLAUDE_MODELS.HAIKU_5_5,
};

/**
 * The effort half of each pairing; see `STEP_DEFAULT_MODELS`. A step's
 * importance alone is not a reason to raise it — nearly every step feeds
 * something downstream that treats its output as fact — so a raise needs a
 * measured gain. Raise one via config where a run needs more depth.
 */
export const STEP_DEFAULT_EFFORTS: Partial<Record<StepType, ClaudeEffort>> = {
  // Decides whether to run another cycle from an already-structured summary; a
  // wrong answer burns a cycle or stops with work unfinished.
  [STEP_TYPES.AUTONOMOUS_GATE]: "high",

  [STEP_TYPES.ANALYZE_README]: "medium",
  [STEP_TYPES.PLAN_TODO]: "medium",
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "medium",
  [STEP_TYPES.RESEARCH]: "medium",
  [STEP_TYPES.COORDINATE_TODOS]: "medium",
  [STEP_TYPES.UPDATE_TODO]: "medium",
  [STEP_TYPES.UPDATE_README]: "medium",
  // The longest-running step, once per batch per repo: it dominates wall clock
  // and spend, so it is the first place to measure a change.
  [STEP_TYPES.EXECUTE]: "medium",
  [STEP_TYPES.CODE_REVIEW]: "medium",
  // A conflict is routinely a symptom — the base renamed or moved what this
  // branch edited — so resolving inside the markers alone is not enough.
  [STEP_TYPES.RESOLVE_CONFLICTS]: "medium",
  [STEP_TYPES.SUGGEST_WORKSPACE]: "medium",
  [STEP_TYPES.GROUND_FINDING]: "medium",

  // Each checks an enumerated list or one stated claim against the code. A
  // `NOT LANDED` from verify-fixes is a hard loop reason for the gate.
  [STEP_TYPES.VERIFY_COMPLETION]: "max",
  [STEP_TYPES.VERIFY_FIXES]: "max",
  [STEP_TYPES.REVIEW_TODOS]: "max",
  [STEP_TYPES.CRITERIA_FEASIBILITY]: "max",
  [STEP_TYPES.VALIDATE_PR_COMMENT]: "max",

  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "xhigh",
  [STEP_TYPES.DISCOVER_GUIDANCE]: "xhigh",
  // A single yes/no, deliberately biased toward proceeding.
  [STEP_TYPES.README_CLARITY_GATE]: "xhigh",
  [STEP_TYPES.DEEP_SEARCH]: "xhigh",
  [STEP_TYPES.CREATE_PR]: "xhigh",

  [STEP_TYPES.PRUNE_SUGGESTIONS]: "low",
  [STEP_TYPES.AGGREGATE_SUGGESTIONS]: "low",
};

/**
 * Resolve the Claude model to use for a given operation type and step.
 *
 * Priority (highest to lowest):
 * 1. `explicitModel` — phase/child direct override
 * 2. `config.operations.typeOverrides[operationType].steps[stepType].model`
 * 3. `config.operations.typeOverrides[operationType].model`
 * 4. `config.operations.model`
 * 5. `STEP_DEFAULT_MODELS[stepType]` — code-level step defaults
 * 6. `undefined` — let CLI use its default
 */
export function resolveModel(
  operationType: OperationType,
  stepType?: StepType,
  explicitModel?: ClaudeModel,
): ClaudeModel | undefined {
  if (explicitModel) return explicitModel;

  const cfg = getConfig();
  const typeOverride = cfg.operations.typeOverrides?.[operationType];

  if (stepType && typeOverride?.steps?.[stepType]?.model) {
    return typeOverride.steps[stepType].model;
  }

  if (typeOverride?.model) {
    return typeOverride.model;
  }

  if (cfg.operations.model) {
    return cfg.operations.model;
  }

  if (stepType) {
    return STEP_DEFAULT_MODELS[stepType];
  }

  return undefined;
}

/**
 * Resolve the Claude CLI `--effort` level for a given operation type and step.
 *
 * Mirrors `resolveModel`'s priority chain:
 * 1. `explicitEffort` — phase/child direct override
 * 2. `config.operations.typeOverrides[operationType].steps[stepType].effort`
 * 3. `config.operations.typeOverrides[operationType].effort`
 * 4. `config.operations.effort`
 * 5. `STEP_DEFAULT_EFFORTS[stepType]` — code-level step defaults
 * 6. `undefined` — let CLI use its default
 */
export function resolveEffort(
  operationType: OperationType,
  stepType?: StepType,
  explicitEffort?: ClaudeEffort,
): ClaudeEffort | undefined {
  if (explicitEffort) return explicitEffort;

  const cfg = getConfig();
  const typeOverride = cfg.operations.typeOverrides?.[operationType];

  if (stepType && typeOverride?.steps?.[stepType]?.effort) {
    return typeOverride.steps[stepType].effort;
  }

  if (typeOverride?.effort) {
    return typeOverride.effort;
  }

  if (cfg.operations.effort) {
    return cfg.operations.effort;
  }

  if (stepType) {
    return STEP_DEFAULT_EFFORTS[stepType];
  }

  return undefined;
}
