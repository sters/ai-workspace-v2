import fs from "node:fs";
import path from "node:path";
import { AI_WORKSPACE_ROOT } from "../config";

/** Bytes to read from the tail of a JSONL file when extracting resultSummary. */
export const TAIL_READ_BYTES = 16 * 1024;

export const OPERATIONS_DIR = path.join(AI_WORKSPACE_ROOT, ".operations");
const VALID_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Workspace names are directory basenames — disallow path separators and traversal. */
const VALID_WORKSPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function validateId(operationId: string): boolean {
  return VALID_ID_RE.test(operationId);
}

export function validateWorkspace(workspace: string): boolean {
  return VALID_WORKSPACE_RE.test(workspace) && !workspace.includes("..");
}

export function workspaceDir(workspace: string): string {
  return path.join(OPERATIONS_DIR, workspace);
}

export function operationFilePath(workspace: string, operationId: string): string {
  return path.join(OPERATIONS_DIR, workspace, `${operationId}.jsonl`);
}

/**
 * Find which workspace directory contains the given operation ID.
 * Returns the workspace name or null if not found.
 */
export function findWorkspaceForOperation(operationId: string): string | null {
  if (!fs.existsSync(OPERATIONS_DIR)) return null;

  for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(OPERATIONS_DIR, entry.name, `${operationId}.jsonl`))) {
      return entry.name;
    }
  }
  return null;
}
