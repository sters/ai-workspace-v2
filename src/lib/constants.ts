/** SWR polling interval for workspace data (ms) */
export const SWR_REFRESH_INTERVAL = 20_000;

/** Operation types that can be auto-started via URL query params. */
export const VALID_AUTO_ACTIONS = new Set<string>([
  "execute",
  "review",
  "create-pr",
  "create-todo",
  "batch",
  "autonomous",
]);
