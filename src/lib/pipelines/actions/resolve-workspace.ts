import { getOperation } from "@/lib/pipeline-manager";

export function resolveWorkspace(operationId: string, fallback?: string): string {
  const op = getOperation(operationId);
  return op?.workspace || fallback || "";
}
