import fs from "node:fs";
import path from "node:path";
import type { OperationListItem } from "@/types/operation";
import type { OperationLogAgeInfo } from "./types";
import { OPERATIONS_DIR, validateWorkspace, workspaceDir } from "./constants";
import { readHeader, readResultSummaryFromTail } from "./reader";

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
