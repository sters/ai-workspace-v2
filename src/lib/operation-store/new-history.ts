import type { OperationListItem } from "@/types/operation";
import { listRecentOperationsByTypes } from "../db";

const NEW_ORIGINATED_TYPES = ["init", "autonomous"] as const;

/**
 * Returns up to `limit` most-recent operations that originated from the
 * "new workspace" flow: all `init` operations, plus `autonomous` operations
 * whose inputs include `startWith === "init"`.
 *
 * Oversamples by 4x to avoid under-filling when many autonomous runs use
 * `startWith === "execute"`.
 */
export function listRecentNewOriginatedOperations(
  limit: number,
): OperationListItem[] {
  if (limit <= 0) return [];
  const oversample = Math.max(limit * 4, limit);
  const candidates = listRecentOperationsByTypes(NEW_ORIGINATED_TYPES, oversample);
  const filtered = candidates.filter(isNewOriginated);
  return filtered.slice(0, limit);
}

function isNewOriginated(op: OperationListItem): boolean {
  if (op.type === "init") return true;
  if (op.type === "autonomous") {
    const inputs = op.inputs as { startWith?: unknown } | undefined;
    return inputs?.startWith === "init";
  }
  return false;
}
