import type { OperationEvent, OperationResultSummary } from "@/types/operation";
import { extractResultSummary } from "../parsers/stream";
import { getEvents, fillMissingOperationResultSummary } from "../db";
import { validateId } from "./constants";

/**
 * Derive a settled operation's result from its persisted events and record it,
 * for an operation that finished without one being written.
 *
 * `markComplete` is what normally writes it, so the gap belongs to an operation
 * that never reached it: one the server was killed mid-run and
 * `failStaleOperations` later settled, or one whose write failed. The events
 * were flushed as they arrived, so the result is still derivable from them —
 * and without this the card shows nothing until it is expanded, since a
 * collapsed card reads the stored summary and connects no stream.
 *
 * Returns the summary when one was written: a row that already has one keeps
 * it, and an operation whose events carry no result gets nothing.
 */
export function backfillResultSummary(
  operationId: string,
  events?: OperationEvent[],
): OperationResultSummary | undefined {
  if (!validateId(operationId)) return undefined;

  const summary = extractResultSummary(events ?? getEvents(operationId));
  if (!summary) return undefined;

  return fillMissingOperationResultSummary(operationId, summary) ? summary : undefined;
}
