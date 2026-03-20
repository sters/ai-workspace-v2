import type { StoredOperationLog } from "./types";
import {
  getOperation as dbGetOperation,
  getEvents,
} from "../db";
import { validateId } from "./constants";

/**
 * Read a stored operation log from SQLite.
 * Returns null if the operation doesn't exist or the ID is invalid.
 */
export function readOperationLog(operationId: string, workspace?: string): StoredOperationLog | null {
  if (!validateId(operationId)) return null;

  const operation = dbGetOperation(operationId);
  if (!operation) return null;

  // If workspace is specified, verify it matches
  if (workspace && operation.workspace !== workspace) return null;

  const events = getEvents(operationId);
  return { operation, events };
}
