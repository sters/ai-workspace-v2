import type { Operation, OperationEvent } from "@/types/operation";

export interface StoredOperationLog {
  operation: Operation;
  events: OperationEvent[];
}

/** Information about a stored operation log with its age. */
export interface OperationLogAgeInfo {
  operationId: string;
  workspace: string;
  type: string;
  startedAt: string;
  ageDays: number;
  isStale: boolean;
}
