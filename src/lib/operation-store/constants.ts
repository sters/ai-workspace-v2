import path from "node:path";
import { getResolvedWorkspaceRoot } from "../config";

/** Base directory for legacy JSONL files. Used by migrate-jsonl.ts. */
export const OPERATIONS_DIR = path.join(getResolvedWorkspaceRoot(), ".operations");

const VALID_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Workspace names are directory basenames — disallow path separators and traversal. */
const VALID_WORKSPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function validateId(operationId: string): boolean {
  return VALID_ID_RE.test(operationId);
}

export function validateWorkspace(workspace: string): boolean {
  return VALID_WORKSPACE_RE.test(workspace) && !workspace.includes("..");
}
