import { getConfig, getOperationConfig } from "@/lib/app-config";
import type { OperationType } from "@/types/operation";

export const MAX_CONCURRENT_OPERATIONS = getConfig().operations.maxConcurrent;

export class ConcurrencyLimitError extends Error {
  constructor(running: number) {
    super(`Too many concurrent operations (${running}/${MAX_CONCURRENT_OPERATIONS}). Try again later.`);
    this.name = "ConcurrencyLimitError";
  }
}

/** Default timeout for Claude execution phases (single/group). */
export const DEFAULT_CLAUDE_TIMEOUT_MS = getConfig().operations.claudeTimeoutMinutes * 60 * 1000;
/** Default timeout for function phases. */
export const DEFAULT_FUNCTION_TIMEOUT_MS = getConfig().operations.functionTimeoutMinutes * 60 * 1000;

/** Get timeout defaults for a specific operation type (respects per-type overrides). */
export function getTimeoutDefaults(type: OperationType): { claudeMs: number; functionMs: number } {
  const cfg = getOperationConfig(type);
  return {
    claudeMs: cfg.claudeTimeoutMinutes * 60 * 1000,
    functionMs: cfg.functionTimeoutMinutes * 60 * 1000,
  };
}
