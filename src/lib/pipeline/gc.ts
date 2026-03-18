import type { ManagedOperation } from "./types";
import { operations } from "./store";

/** Max age in ms for completed operations before GC (5 minutes). Logs are persisted to disk. */
const GC_MAX_AGE_MS = 5 * 60 * 1000;
/** Max number of completed operations to keep in memory. Logs are persisted to disk. */
const GC_MAX_COMPLETED = 10;

/** Exported for testing. */
export const _gc = { GC_MAX_AGE_MS, GC_MAX_COMPLETED };

export function gcCompletedOperations() {
  const now = Date.now();
  const completed: [string, ManagedOperation][] = [];

  for (const [id, managed] of operations) {
    if (managed.completedAt != null) {
      // Remove operations older than GC_MAX_AGE_MS
      if (now - managed.completedAt > GC_MAX_AGE_MS) {
        operations.delete(id);
      } else {
        completed.push([id, managed]);
      }
    }
  }

  // If still too many completed operations, remove oldest
  if (completed.length > GC_MAX_COMPLETED) {
    completed.sort((a, b) => (a[1].completedAt ?? 0) - (b[1].completedAt ?? 0));
    const toRemove = completed.length - GC_MAX_COMPLETED;
    for (let i = 0; i < toRemove; i++) {
      operations.delete(completed[i][0]);
    }
  }
}
