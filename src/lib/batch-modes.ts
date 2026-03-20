/**
 * Centralized batch mode definitions.
 *
 * Batch modes describe multi-step operation pipelines (e.g. Execute → Review → PR).
 * These definitions are shared across operation-panel, todo-updater, new-workspace,
 * init-next-actions, next-action-suggestions, and repo-todo-card.
 */

export type BatchMode =
  | "execute-review"
  | "execute-pr"
  | "execute-review-pr-gated"
  | "execute-review-pr";

export interface BatchModeDefinition {
  mode: BatchMode;
  /** Suffix after the startWith label, e.g. " → Review" */
  suffix: string;
}

const BATCH_MODES: BatchModeDefinition[] = [
  { mode: "execute-review", suffix: "Execute \u2192 Review" },
  { mode: "execute-pr", suffix: "Execute \u2192 PR" },
  { mode: "execute-review-pr-gated", suffix: "Execute \u2192 Review \u2192 PR (gated)" },
  { mode: "execute-review-pr", suffix: "Execute \u2192 Review \u2192 PR" },
];

const START_LABELS: Record<string, string> = {
  init: "Init",
  execute: "Execute",
  "update-todo": "Update",
};

/**
 * Build batch mode labels for a given startWith step.
 * Returns items like "Init → Execute → Review" for startWith="init".
 * When startWith is "execute", the prefix is omitted (e.g. "Execute → Review").
 */
export function getBatchModeLabels(
  startWith: string,
): { label: string; mode: BatchMode }[] {
  const prefix = START_LABELS[startWith];
  return BATCH_MODES.map(({ mode, suffix }) => ({
    label: prefix && startWith !== "execute"
      ? `${prefix} \u2192 ${suffix}`
      : suffix,
    mode,
  }));
}

/**
 * Build SplitButton items for batch operations.
 * Each item calls `onSelect` with the batch body.
 */
export function buildBatchItems(
  startWith: string,
  baseBody: Record<string, string>,
  onSelect: (body: Record<string, string>) => void,
): { label: string; onClick: () => void }[] {
  return getBatchModeLabels(startWith).map(({ label, mode }) => ({
    label,
    onClick: () =>
      onSelect({
        ...baseBody,
        startWith,
        mode,
      }),
  }));
}

/**
 * Build NextAction-compatible batch items for next-action-suggestions.
 */
export function buildNextActionBatchItems(
  startWith: string,
  workspace: string,
): { label: string; type: "batch"; body: Record<string, string> }[] {
  return getBatchModeLabels(startWith).map(({ label, mode }) => ({
    label,
    type: "batch" as const,
    body: { startWith, mode, workspace },
  }));
}

// ---------------------------------------------------------------------------
// Autonomous helpers
// ---------------------------------------------------------------------------

const AUTONOMOUS_START_LABELS: Record<string, string> = {
  init: "Init",
  execute: "Execute",
  "update-todo": "Update",
};

function getAutonomousLabel(startWith: string): string {
  const prefix = AUTONOMOUS_START_LABELS[startWith];
  const suffix = "Autonomous (Loop)";
  return prefix && startWith !== "execute"
    ? `${prefix} \u2192 ${suffix}`
    : suffix;
}

/**
 * Build SplitButton items for autonomous operations.
 */
export function buildAutonomousItems(
  startWith: string,
  baseBody: Record<string, string>,
  onSelect: (body: Record<string, string>) => void,
): { label: string; onClick: () => void }[] {
  return [{
    label: getAutonomousLabel(startWith),
    onClick: () =>
      onSelect({
        ...baseBody,
        startWith,
      }),
  }];
}

/**
 * Build NextAction-compatible autonomous items for next-action-suggestions.
 */
export function buildNextActionAutonomousItems(
  startWith: string,
  workspace: string,
): { label: string; type: "autonomous"; body: Record<string, string> }[] {
  return [{
    label: getAutonomousLabel(startWith),
    type: "autonomous" as const,
    body: { startWith, workspace },
  }];
}

/** Autonomous params that may appear in URL search params. */
const AUTONOMOUS_URL_KEYS = ["startWith", "instruction", "draft", "maxLoops"] as const;

/**
 * Extract autonomous-related params from URLSearchParams.
 */
export function extractAutonomousParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of AUTONOMOUS_URL_KEYS) {
    const val = searchParams.get(key);
    if (val) params[key] = val;
  }
  return params;
}

// ---------------------------------------------------------------------------
// Batch URL extraction
// ---------------------------------------------------------------------------

/** Batch params that may appear in URL search params. */
const BATCH_URL_KEYS = ["startWith", "mode", "instruction", "draft"] as const;

/**
 * Extract batch-related params from URLSearchParams.
 */
export function extractBatchParams(
  searchParams: URLSearchParams,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of BATCH_URL_KEYS) {
    const val = searchParams.get(key);
    if (val) params[key] = val;
  }
  return params;
}
