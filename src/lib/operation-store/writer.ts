import type { Operation, OperationResultSummary } from "@/types/operation";
import {
  updateOperationStatus,
  updateOperationMeta,
} from "../db";
import { validateId, validateWorkspace } from "./constants";

/**
 * Persist a completed operation to SQLite.
 *
 * Events are already flushed incrementally by the event buffer, so this only
 * updates the operation row (status, completedAt, resultSummary). The result is
 * passed in rather than re-derived: the caller holds it in memory for the
 * listing, and two extractions of the same stream are two things to disagree.
 */
export function writeOperationLog(
  operation: Operation,
  resultSummary?: OperationResultSummary,
): void {
  if (!validateId(operation.id)) return;
  if (!validateWorkspace(operation.workspace)) return;

  updateOperationStatus(
    operation.id,
    operation.status,
    operation.completedAt,
  );

  if (resultSummary || operation.children || operation.phases) {
    updateOperationMeta(operation.id, {
      children: operation.children,
      phases: operation.phases,
      resultSummary,
    });
  }
}
