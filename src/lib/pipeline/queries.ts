import type { Operation, OperationEvent, OperationListItem } from "@/types/operation";
import type { ManagedOperation } from "./types";
import { operations } from "./store";
import { gcCompletedOperations } from "./gc";
import { extractLastResult } from "@/lib/parsers/stream";

export function getOperations(): Operation[] {
  gcCompletedOperations();
  return Array.from(operations.values()).map((m) => m.operation);
}

function toSummary(managed: ManagedOperation): OperationListItem {
  const op = managed.operation;
  const currentPhase = op.phases?.find((p) => p.status === "running");
  const resultSummary = op.status !== "running" && managed.events.length > 0
    ? extractLastResult(managed.events)
    : undefined;
  return {
    id: op.id,
    type: op.type,
    workspace: op.workspace,
    status: op.status,
    startedAt: op.startedAt,
    completedAt: op.completedAt,
    ...(currentPhase && { currentPhase }),
    ...(op.inputs && { inputs: op.inputs }),
    ...(resultSummary && { resultSummary }),
    ...(managed.hasPendingAsk && { hasPendingAsk: true }),
  };
}

export function getOperationSummaries(): OperationListItem[] {
  gcCompletedOperations();
  return Array.from(operations.values()).map((m) => toSummary(m));
}

export function getOperation(id: string): Operation | undefined {
  return operations.get(id)?.operation;
}

export function getOperationEvents(id: string): OperationEvent[] {
  return operations.get(id)?.events ?? [];
}

export function subscribeToOperation(
  id: string,
  listener: (event: OperationEvent) => void,
): () => void {
  const managed = operations.get(id);
  if (!managed) return () => {};
  managed.listeners.add(listener);
  return () => managed.listeners.delete(listener);
}

export function deleteOperation(id: string): boolean {
  const managed = operations.get(id);
  if (!managed) return false;
  // Only allow deleting completed/failed operations
  if (managed.operation.status === "running") return false;
  operations.delete(id);
  return true;
}
