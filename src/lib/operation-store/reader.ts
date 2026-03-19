import fs from "node:fs";
import { storedHeaderSchema, storedEventSchema } from "../runtime-schemas";
import { extractLastResult } from "../parsers/stream";
import type { Operation, OperationEvent } from "@/types/operation";
import type { StoredOperationLog } from "./types";
import {
  TAIL_READ_BYTES,
  validateId,
  validateWorkspace,
  operationFilePath,
  findWorkspaceForOperation,
} from "./constants";

/**
 * Read only the first line (header) of a JSONL file without loading the rest.
 * Uses a small fixed buffer to avoid reading the entire file.
 */
export function readHeader(fp: string): Operation | null {
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
export function readResultSummaryFromTail(
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

  const fp = operationFilePath(ws, operationId);
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
