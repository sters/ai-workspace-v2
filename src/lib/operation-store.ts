import fs from "node:fs";
import path from "node:path";
import { AI_WORKSPACE_ROOT } from "./config";
import { extractLastResult } from "./parsers/stream";
import type { Operation, OperationEvent, OperationListItem } from "@/types/operation";
import { storedHeaderSchema, storedEventSchema } from "./runtime-schemas";

/** Bytes to read from the tail of a JSONL file when extracting resultSummary. */
const TAIL_READ_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPERATIONS_DIR = path.join(AI_WORKSPACE_ROOT, ".operations");
const VALID_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

    const headerResult = storedHeaderSchema.safeParse(JSON.parse(lines[0]));
    if (!headerResult.success) return null;

    const events: OperationEvent[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const eventResult = storedEventSchema.safeParse(JSON.parse(lines[i]));
        if (eventResult.success) {
          const { _type: _, ...event } = eventResult.data;
          events.push(event as unknown as OperationEvent);
        }
      } catch {
        // Skip corrupted lines
      }
    }

    return { operation: headerResult.data.operation as Operation, events };
  } catch {
    return null;
  }
}

/**
 * Read only the first line (header) of a JSONL file without loading the rest.
 * Uses a small fixed buffer to avoid reading the entire file.
 */
function readHeader(fp: string): Operation | null {
  const fd = fs.openSync(fp, "r");
  try {
    // Header lines are typically under 2KB; read up to 8KB to be safe
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    if (bytesRead === 0) return null;

    const chunk = buf.toString("utf-8", 0, bytesRead);
    const newlineIdx = chunk.indexOf("\n");
    const firstLine = newlineIdx === -1 ? chunk : chunk.slice(0, newlineIdx);
    const headerResult = storedHeaderSchema.safeParse(JSON.parse(firstLine));
    return headerResult.success ? (headerResult.data.operation as Operation) : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract resultSummary by reading only the tail of a JSONL file.
 * Seeks to (fileSize - TAIL_READ_BYTES) and parses lines backwards to find
 * the last result event, avoiding loading the entire file into memory.
 */
function readResultSummaryFromTail(
  fp: string,
): ReturnType<typeof extractLastResult> {
  const stat = fs.statSync(fp);
  if (stat.size === 0) return undefined;

  const fd = fs.openSync(fp, "r");
  try {
    const readSize = Math.min(stat.size, TAIL_READ_BYTES);
    const offset = stat.size - readSize;
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, offset);
    const tail = buf.toString("utf-8");

    // Split into lines and scan backwards for the last result event
    const lines = tail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const eventResult = storedEventSchema.safeParse(JSON.parse(line));
        if (!eventResult.success) continue;
        const { _type: _, ...event } = eventResult.data;
        const result = extractLastResult([event as unknown as OperationEvent]);
        if (result) return result;
      } catch {
        // skip malformed lines (including partial first line from seek offset)
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * List stored operations as lightweight summaries.
 * If workspace is provided, only scans that directory.
 * Otherwise scans all workspace directories.
 * Returns summaries sorted by startedAt descending (newest first).
 *
 * Only reads the header (first line) and tail of each JSONL file to avoid
 * loading entire operation logs into memory.
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
        const op = readHeader(fp);
        if (!op) continue;

        summaries.push({
          id: op.id,
          type: op.type,
          workspace: op.workspace,
          status: op.status,
          startedAt: op.startedAt,
          completedAt: op.completedAt,
          ...(op.inputs && Object.keys(op.inputs).length > 0 && { inputs: op.inputs }),
          resultSummary: readResultSummaryFromTail(fp),
        });
      } catch {
        // Skip corrupted files
      }
    }
  }

  // Sort by startedAt descending
  summaries.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return summaries;
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

/**
 * List all stored operation logs with age information.
 * Used by the operation-prune pipeline to identify old logs.
 * Returns entries sorted by startedAt ascending (oldest first).
 */
export function listAllOperationLogsWithAge(staleDays: number): OperationLogAgeInfo[] {
  if (!fs.existsSync(OPERATIONS_DIR)) return [];

  const now = Date.now();
  const result: OperationLogAgeInfo[] = [];

  for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(OPERATIONS_DIR, entry.name);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      try {
        const fp = path.join(dir, file);
        const op = readHeader(fp);
        if (!op) continue;

        const startedAtMs = new Date(op.startedAt).getTime();
        const ageDays = Math.floor((now - startedAtMs) / (24 * 60 * 60 * 1000));

        result.push({
          operationId: op.id,
          workspace: entry.name,
          type: op.type,
          startedAt: op.startedAt,
          ageDays,
          isStale: ageDays >= staleDays,
          filePath: fp,
        });
      } catch {
        // Skip corrupted files
      }
    }
  }

  return result.sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
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
