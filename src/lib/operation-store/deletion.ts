import fs from "node:fs";
import {
  validateId,
  validateWorkspace,
  workspaceDir,
  operationFilePath,
  findWorkspaceForOperation,
} from "./constants";

/**
 * Delete all stored operation logs for a workspace.
 * Removes the entire workspace subdirectory under `.operations/`.
 * Returns true if the directory existed and was deleted.
 */
export function deleteStoredOperationsForWorkspace(workspace: string): boolean {
  if (!validateWorkspace(workspace)) return false;

  const dir = workspaceDir(workspace);
  if (!fs.existsSync(dir)) return false;

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Delete a stored operation log from disk.
 * If workspace is provided, looks directly in that directory.
 * Otherwise searches across all workspace directories.
 * Returns true if the file was deleted, false if it didn't exist.
 */
export function deleteStoredOperation(operationId: string, workspace?: string): boolean {
  if (!validateId(operationId)) return false;

  let ws: string | undefined = workspace;
  if (ws) {
    if (!validateWorkspace(ws)) return false;
  } else {
    ws = findWorkspaceForOperation(operationId) ?? undefined;
    if (!ws) return false;
  }

  const fp = operationFilePath(ws, operationId);
  if (!fs.existsSync(fp)) return false;

  fs.unlinkSync(fp);
  return true;
}
