import type { ClaudeEffort, ClaudeModel } from "@/types/claude";
import type { OperationType } from "@/types/operation";
import type { StepType } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import { getConfig } from "./resolver";

/**
 * Code-level default models per step type.
 * These are the lowest-priority defaults — config overrides them.
 *
 * Keep in sync with `STEP_DEFAULT_EFFORTS`: a step listed in one table and not
 * the other is a drift bug, and `effort.test.ts` fails on it.
 */
export const STEP_DEFAULT_MODELS: Partial<Record<StepType, ClaudeModel>> = {
  // Opus — plan-shaped steps that benefit from deep thinking up front,
  // plus execution/review/coordination steps where quality compounds downstream.
  [STEP_TYPES.ANALYZE_README]: "opus",
  [STEP_TYPES.PLAN_TODO]: "opus",
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "opus",
  [STEP_TYPES.EXECUTE]: "opus",
  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "opus",
  [STEP_TYPES.VERIFY_README]: "opus",
  [STEP_TYPES.CODE_REVIEW]: "opus",
  [STEP_TYPES.REVIEW_TODOS]: "opus",
  [STEP_TYPES.COORDINATE_TODOS]: "opus",
  // `research` covers all three research phases (per-repo + cross-repo
  // findings, recommendations, integration) — the findings phases are the
  // deliverable of the whole operation, not a step toward one.
  [STEP_TYPES.RESEARCH]: "opus",
  // Both rewrite workspace documents that later phases treat as authoritative:
  // the TODO list the executor consumes and the gate audits, and the README
  // done-contract the verifier and gate enforce.
  [STEP_TYPES.UPDATE_TODO]: "opus",
  [STEP_TYPES.UPDATE_README]: "opus",
  // Not just a decision: on `synthesize` this same call merges the candidates'
  // implementations into the original worktree, and everything downstream
  // builds on the result.
  [STEP_TYPES.BEST_OF_N_REVIEWER]: "opus",

  // Sonnet — everything else, from procedural work down to plain extraction.
  // There is no haiku tier: a current-generation Sonnet at low effort beats a
  // smaller model at high effort on these steps for comparable spend, and the
  // extraction steps feed the autonomous gate, where a silent misread is
  // expensive. Cost is controlled through effort instead (see below).
  [STEP_TYPES.CREATE_PR]: "sonnet",
  // The markdown best-of-N pair (`best-of-n-files.ts`): pick a winner, then
  // splice documents together. No code is involved in either.
  [STEP_TYPES.BEST_OF_N_FILE_REVIEWER]: "sonnet",
  [STEP_TYPES.BEST_OF_N_SYNTHESIZER]: "sonnet",
  [STEP_TYPES.SUGGEST_WORKSPACE]: "sonnet",
  [STEP_TYPES.AUTONOMOUS_GATE]: "sonnet",
  [STEP_TYPES.README_CLARITY_GATE]: "sonnet",
  [STEP_TYPES.PRUNE_SUGGESTIONS]: "sonnet",
  [STEP_TYPES.COLLECT_REVIEWS]: "sonnet",
  [STEP_TYPES.VERIFY_TODO]: "sonnet",
  [STEP_TYPES.DEEP_SEARCH]: "sonnet",
  [STEP_TYPES.AGGREGATE_SUGGESTIONS]: "sonnet",
};

/**
 * Code-level default `--effort` levels per step type.
 *
 * Effort — not the model tier — is the primary cost/latency dial, so every step
 * declares one explicitly rather than inheriting the CLI default. Both tables
 * cover every `STEP_TYPES` value, so adding a step type forces a tier choice
 * (enforced by `effort.test.ts`).
 *
 * The tiers are about the shape of the work, not its importance:
 *   high   — open-ended investigation, or a judgment the rest of the pipeline
 *            then enforces as fact (the README contract, the loop decision).
 *   medium — bounded translation / checklist work over an input that already
 *            says what needs doing.
 *   low    — extraction and aggregation over already-structured text.
 *
 * `xhigh` and `max` are intentionally absent: they are worth reaching for on a
 * specific hard workload, measured, via config — not as a blanket default.
 */
export const STEP_DEFAULT_EFFORTS: Partial<Record<StepType, ClaudeEffort>> = {
  [STEP_TYPES.ANALYZE_README]: "high",
  [STEP_TYPES.PLAN_TODO]: "high",
  [STEP_TYPES.EXECUTE]: "high",
  [STEP_TYPES.RESEARCH]: "high",
  [STEP_TYPES.VERIFY_README]: "high",
  [STEP_TYPES.CODE_REVIEW]: "high",
  [STEP_TYPES.COORDINATE_TODOS]: "high",
  [STEP_TYPES.UPDATE_README]: "high",
  [STEP_TYPES.BEST_OF_N_REVIEWER]: "high",
  [STEP_TYPES.AUTONOMOUS_GATE]: "high",

  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "medium",
  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "medium",
  [STEP_TYPES.REVIEW_TODOS]: "medium",
  // Same shape as plan-todo-from-review: turn review findings into TODO items.
  [STEP_TYPES.UPDATE_TODO]: "medium",
  [STEP_TYPES.CREATE_PR]: "medium",
  [STEP_TYPES.BEST_OF_N_FILE_REVIEWER]: "medium",
  [STEP_TYPES.BEST_OF_N_SYNTHESIZER]: "medium",
  [STEP_TYPES.README_CLARITY_GATE]: "medium",
  [STEP_TYPES.SUGGEST_WORKSPACE]: "medium",
  [STEP_TYPES.PRUNE_SUGGESTIONS]: "medium",

  [STEP_TYPES.COLLECT_REVIEWS]: "low",
  [STEP_TYPES.VERIFY_TODO]: "low",
  [STEP_TYPES.DEEP_SEARCH]: "low",
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
