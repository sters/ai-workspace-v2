import type { OperationType } from "@/types/operation";

/** SWR polling interval for workspace data (ms) */
export const SWR_REFRESH_INTERVAL = 20_000;

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
