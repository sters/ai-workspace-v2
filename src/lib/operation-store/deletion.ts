import {
  deleteOperation as dbDeleteOperation,
  deleteOperationsForWorkspace as dbDeleteOperationsForWorkspace,
} from "../db";
import { validateId, validateWorkspace } from "./constants";

/**
 * Delete all stored operation logs for a workspace.
 * Returns true if any operations were deleted.
 */
export function deleteStoredOperationsForWorkspace(workspace: string): boolean {
  if (!validateWorkspace(workspace)) return false;
  return dbDeleteOperationsForWorkspace(workspace);
}

/**
 * Delete a stored operation log.
 * CASCADE deletes associated events automatically.
 * Returns true if the operation was deleted.
 */
export function deleteStoredOperation(operationId: string, _workspace?: string): boolean {
  if (!validateId(operationId)) return false;
  return dbDeleteOperation(operationId);
}
