import { getConfig, getOperationConfig } from "@/lib/config";
import type { OperationType } from "@/types/operation";

/** Get the current max concurrent operations limit (reads config at call time). */
export function getMaxConcurrentOperations(): number {
  return getConfig().operations.maxConcurrent;
}

/**
 * @deprecated Use `getMaxConcurrentOperations()` instead. This constant is
 * evaluated once at module load time and may become stale if config changes.
 */
export const MAX_CONCURRENT_OPERATIONS = getConfig().operations.maxConcurrent;

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

/**
 * @deprecated Use `getTimeoutDefaults(type).claudeMs` instead. This constant
 * is evaluated once at module load time and does not respect per-type overrides.
 */
export const DEFAULT_CLAUDE_TIMEOUT_MS = getConfig().operations.claudeTimeoutMinutes * 60 * 1000;

/**
 * @deprecated Use `getTimeoutDefaults(type).functionMs` instead. This constant
 * is evaluated once at module load time and does not respect per-type overrides.
 */
export const DEFAULT_FUNCTION_TIMEOUT_MS = getConfig().operations.functionTimeoutMinutes * 60 * 1000;
