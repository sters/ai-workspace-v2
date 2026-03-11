import fs from "node:fs";
import path from "node:path";
import { AI_WORKSPACE_ROOT } from "./config";
import type { Operation, OperationEvent, OperationListItem } from "@/types/operation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATIONS_DIR = path.join(AI_WORKSPACE_ROOT, ".operations");
const VALID_ID_RE = /^pipe-\d+-\d+$/;
/** Workspace names are directory basenames — disallow path separators and traversal. */
const VALID_WORKSPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateId(operationId: string): boolean {
  return VALID_ID_RE.test(operationId);
}

function validateWorkspace(workspace: string): boolean {
  return VALID_WORKSPACE_RE.test(workspace) && !workspace.includes("..");
}

function workspaceDir(workspace: string): string {
  return path.join(OPERATIONS_DIR, workspace);
}

function filePath(workspace: string, operationId: string): string {
  return path.join(OPERATIONS_DIR, workspace, `${operationId}.jsonl`);
}

/**
 * Find which workspace directory contains the given operation ID.
 * Returns the workspace name or null if not found.
 */
function findWorkspaceForOperation(operationId: string): string | null {
  if (!fs.existsSync(OPERATIONS_DIR)) return null;

  for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(OPERATIONS_DIR, entry.name, `${operationId}.jsonl`))) {
      return entry.name;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface StoredHeader {
  _type: "header";
  operation: Operation;
}

interface StoredEvent {
  _type: "event";
  [key: string]: unknown;
}

export interface StoredOperationLog {
  operation: Operation;
  events: OperationEvent[];
}

/**
 * Write an operation log to disk as JSONL.
 * Stored at `.operations/{workspace}/{operationId}.jsonl`.
 * Line 1: header with operation metadata.
 * Lines 2..N: individual events.
 */
export function writeOperationLog(
  operation: Operation,
  events: OperationEvent[],
): void {
  if (!validateId(operation.id)) return;
  if (!validateWorkspace(operation.workspace)) return;

  const dir = workspaceDir(operation.workspace);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [];
  lines.push(JSON.stringify({ _type: "header", operation } satisfies StoredHeader));
  for (const event of events) {
    lines.push(JSON.stringify({ _type: "event", ...event } satisfies StoredEvent));
  }

  fs.writeFileSync(filePath(operation.workspace, operation.id), lines.join("\n") + "\n");
}

/**
 * Read a stored operation log from disk.
 * If workspace is provided, looks directly in that directory.
 * Otherwise searches across all workspace directories.
 * Returns null if the file doesn't exist or is corrupted.
 */
export function readOperationLog(operationId: string, workspace?: string): StoredOperationLog | null {
  if (!validateId(operationId)) return null;

  let ws: string | undefined = workspace;
  if (ws) {
    if (!validateWorkspace(ws)) return null;
  } else {
    ws = findWorkspaceForOperation(operationId) ?? undefined;
    if (!ws) return null;
  }

  const fp = filePath(ws, operationId);
  if (!fs.existsSync(fp)) return null;

  try {
    const content = fs.readFileSync(fp, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length === 0) return null;

    const header = JSON.parse(lines[0]) as StoredHeader;
    if (header._type !== "header" || !header.operation) return null;

    const events: OperationEvent[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]) as StoredEvent;
        if (parsed._type === "event") {
          const { _type: _, ...event } = parsed;
          events.push(event as unknown as OperationEvent);
        }
      } catch {
        // Skip corrupted lines
      }
    }

    return { operation: header.operation, events };
  } catch {
    return null;
  }
}

/**
 * List stored operations as lightweight summaries.
 * If workspace is provided, only scans that directory.
 * Otherwise scans all workspace directories.
 * Returns summaries sorted by startedAt descending (newest first).
 */
export function listStoredOperations(workspace?: string): OperationListItem[] {
  if (!fs.existsSync(OPERATIONS_DIR)) return [];

  const dirs: string[] = [];
  if (workspace) {
    if (!validateWorkspace(workspace)) return [];
    const dir = workspaceDir(workspace);
    if (fs.existsSync(dir)) dirs.push(dir);
  } else {
    for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(path.join(OPERATIONS_DIR, entry.name));
      }
    }
  }

  const summaries: OperationListItem[] = [];

  for (const dir of dirs) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      try {
        const fp = path.join(dir, file);
        const content = fs.readFileSync(fp, "utf-8");
        const firstNewline = content.indexOf("\n");
        const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
        const header = JSON.parse(firstLine) as StoredHeader;
        if (header._type === "header" && header.operation) {
          const op = header.operation;
          summaries.push({
            id: op.id,
            type: op.type,
            workspace: op.workspace,
            status: op.status,
            startedAt: op.startedAt,
            completedAt: op.completedAt,
            ...(op.inputs && Object.keys(op.inputs).length > 0 && { inputs: op.inputs }),
          });
        }
      } catch {
        // Skip corrupted files
      }
    }
  }

  // Sort by startedAt descending
  summaries.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return summaries;
}

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

  const fp = filePath(ws, operationId);
  if (!fs.existsSync(fp)) return false;

  fs.unlinkSync(fp);
  return true;
}
