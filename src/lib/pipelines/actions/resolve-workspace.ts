import { getOperation } from "@/lib/pipeline-manager";

/** Resolve the workspace name from the running operation, with optional fallback. */
export function resolveWorkspace(operationId: string, fallback?: string): string {
  const op = getOperation(operationId);
  return op?.workspace || fallback || "";
}
