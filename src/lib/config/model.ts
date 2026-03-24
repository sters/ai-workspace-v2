import type { ClaudeModel } from "@/types/claude";
import type { OperationType } from "@/types/operation";
import type { StepType } from "@/types/pipeline";
import { getConfig } from "./resolver";

/**
 * Resolve the Claude model to use for a given operation type and step.
 *
 * Priority (highest to lowest):
 * 1. `explicitModel` — phase/child direct override
 * 2. `config.operations.typeOverrides[operationType].steps[stepType].model`
 * 3. `config.operations.typeOverrides[operationType].model`
 * 4. `config.operations.model`
 * 5. `undefined` — let CLI use its default
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

  return undefined;
}
