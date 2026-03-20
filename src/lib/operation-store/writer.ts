import type { Operation, OperationEvent } from "@/types/operation";
import { extractLastResult } from "../parsers/stream";
import {
  updateOperationStatus,
  updateOperationMeta,
} from "../db";
import { validateId, validateWorkspace } from "./constants";

/**
 * Persist a completed operation to SQLite.
 *
 * Events are already flushed incrementally by the event buffer,
 * so this only updates the operation row (status, completedAt, resultSummary).
 */
export function writeOperationLog(
  operation: Operation,
  events: OperationEvent[],
): void {
  if (!validateId(operation.id)) return;
  if (!validateWorkspace(operation.workspace)) return;

  updateOperationStatus(
    operation.id,
    operation.status,
    operation.completedAt,
  );

  const resultSummary = extractLastResult(events);
  if (resultSummary || operation.children || operation.phases) {
    updateOperationMeta(operation.id, {
      children: operation.children,
      phases: operation.phases,
      resultSummary,
    });
  }
}
