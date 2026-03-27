import type { ClaudeModel } from "@/types/claude";
import type { OperationType } from "@/types/operation";
import type { StepType } from "@/types/pipeline";
import { STEP_TYPES } from "@/types/pipeline";
import { getConfig } from "./resolver";

/**
 * Code-level default models per step type.
 * These are the lowest-priority defaults — config overrides them.
 */
export const STEP_DEFAULT_MODELS: Partial<Record<StepType, ClaudeModel>> = {
  // Sonnet — structured analysis, review, coordination tasks
  [STEP_TYPES.CREATE_PR]: "sonnet",
  [STEP_TYPES.COORDINATE_TODOS]: "sonnet",
  [STEP_TYPES.REVIEW_TODOS]: "sonnet",
  [STEP_TYPES.BEST_OF_N_REVIEWER]: "sonnet",
  [STEP_TYPES.PLAN_TODO_FROM_REVIEW]: "sonnet",
  [STEP_TYPES.DISCOVER_CONSTRAINTS]: "sonnet",

  // Haiku — simple extraction, aggregation, verification tasks
  [STEP_TYPES.COLLECT_REVIEWS]: "haiku",
  [STEP_TYPES.VERIFY_TODO]: "haiku",
  [STEP_TYPES.DEEP_SEARCH]: "haiku",
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
