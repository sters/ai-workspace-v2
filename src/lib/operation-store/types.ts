import type { Operation, OperationEvent } from "@/types/operation";

export interface StoredHeader {
  _type: "header";
  operation: Operation;
}

export interface StoredEvent {
  _type: "event";
  [key: string]: unknown;
}

export interface StoredOperationLog {
  operation: Operation;
  events: OperationEvent[];
}

/** Information about a stored operation log file with its age. */
export interface OperationLogAgeInfo {
  operationId: string;
  workspace: string;
  type: string;
  startedAt: string;
  ageDays: number;
  isStale: boolean;
  filePath: string;
}
