import type { OperationType } from "@/types/operation";

/** SWR polling interval for workspace data (ms) */
export const SWR_REFRESH_INTERVAL = 20_000;

/**
 * Most an artifact is read as text. Reports are markdown; anything far past this
 * is not one. Lives here rather than next to the reader because the viewer needs
 * it to say what it cut off.
 */
export const ARTIFACT_MAX_BYTES = 512 * 1024;

/**
 * Most of one file's diff the Changes tab reads. A lockfile or generated file
 * diff runs to megabytes and nobody reads it line by line in a browser.
 */
export const CHANGES_DIFF_MAX_BYTES = 512 * 1024;

/** Operation types that can be auto-started via URL query params. */
const _VALID_AUTO_ACTIONS = new Set<OperationType>([
  "execute",
  "review",
  "create-pr",
  "create-todo",
  "batch",
  "autonomous",
]);
// Exposed as ReadonlySet<string> so callers can pass untyped strings from
// URL search params without needing to narrow first.
export const VALID_AUTO_ACTIONS: ReadonlySet<string> = _VALID_AUTO_ACTIONS;
