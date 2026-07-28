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

/**
 * Wall-clock allowance per TODO item of batch capacity in an execute phase.
 *
 * Measured ~1.85min/item over review follow-up batches (a 10-item batch took
 * 18.5min), so this leaves ~60% margin. Deliberately loose: a phase killed by
 * its timeout is retried on the *same* budget, so it times out again and
 * re-runs every Claude child from scratch (see **Phase retries**). Overshooting
 * costs nothing — a batch that finishes early just proceeds.
 */
export const PER_ITEM_BUDGET_MS = 3 * 60 * 1000;

/**
 * Batch count an execute phase is budgeted to cover when the real count isn't
 * known until run time — which is the case for `autonomous`, whose cycle phases
 * are built before any TODO file is read.
 */
export const ROUTINE_BATCH_COUNT = 2;

/**
 * Budget for an execute phase covering `batchCount` batches of `batchSize`.
 *
 * Sized per **item of batch capacity**, not per batch: a flat per-batch figure
 * meant raising `batchSize` *shrank* the budget for identical work, since the
 * same items then packed into fewer batches. Budgeting capacity (items rounded
 * up to a multiple of `batchSize`) rather than the exact item count deliberately
 * over-allocates on the one-item-over case.
 *
 * Shared by both places that budget execute work — `buildExecutePipeline`, which
 * knows the real batch count, and `autonomous`'s cycle phase, which wraps that
 * pipeline through `runSubPhases` and so supplies the only budget that actually
 * applies. A wrapper tighter than the pipeline it wraps fires first and makes
 * the inner sizing dead code, which is what two hardcoded copies produced.
 */
export function executePhaseBudgetMs(batchCount: number, batchSize: number): number {
  return Math.max(1, batchCount) * batchSize * PER_ITEM_BUDGET_MS + 5 * 60 * 1000;
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
