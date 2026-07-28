import { getConfig, getOperationConfig } from "@/lib/config";
import type { OperationType } from "@/types/operation";

/** Get the current max concurrent operations limit (reads config at call time). */
export function getMaxConcurrentOperations(): number {
  return getConfig().operations.maxConcurrent;
}

/**
 * Max Claude children started concurrently within one parallel group.
 *
 * Read at call time, and shared by both places that build a group semaphore —
 * `runGroupPhase` (top-level `kind: "group"` phases) and `ctx.runChildGroup`
 * (groups run from inside a function phase, which is the path `autonomous`
 * takes). Those two used to hold independent hardcoded copies of this number,
 * so raising one silently left the other path capped.
 *
 * Clamped to >= 1 because `new Semaphore(n)` throws below that, which would fail
 * the phase outright rather than degrade.
 */
export function getMaxGroupConcurrency(): number {
  return Math.max(1, Math.floor(getConfig().operations.maxGroupConcurrency));
}

export class ConcurrencyLimitError extends Error {
  constructor(running: number) {
    super(`Too many concurrent operations (${running}/${getMaxConcurrentOperations()}). Try again later.`);
    this.name = "ConcurrencyLimitError";
  }
}

/** Get timeout defaults for a specific operation type (respects per-type overrides). */
export function getTimeoutDefaults(type: OperationType): { claudeMs: number; functionMs: number } {
  const cfg = getOperationConfig(type);
  return {
    claudeMs: cfg.claudeTimeoutMinutes * 60 * 1000,
    functionMs: cfg.functionTimeoutMinutes * 60 * 1000,
  };
}
