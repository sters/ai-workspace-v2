import fs from "node:fs";
import path from "node:path";
import { storedHeaderSchema, storedEventSchema } from "../runtime-schemas";
import { extractLastResult } from "../parsers/stream";
import { getDb } from "./connection";
import { OPERATIONS_DIR } from "../operation-store/constants";
import type { Operation, OperationEvent } from "@/types/operation";

/**
 * Read a JSONL operation log from disk (used during migration only).
 */
function readJsonlFile(fp: string): { operation: Operation; events: OperationEvent[] } | null {
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
 * Migrate all JSONL operation logs to SQLite.
 * Scans `.operations/` directory, imports each file into the database,
 * and deletes the original files on success.
 *
 * Should be called on first DB access when operations table is empty
 * and `.operations/` directory exists.
 */
export function migrateJsonlToSqlite(): { migrated: number; errors: number } {
  if (!fs.existsSync(OPERATIONS_DIR)) {
    return { migrated: 0, errors: 0 };
  }

  const db = getDb();

  // Check if there are already operations in SQLite
  const count = db.query("SELECT COUNT(*) as c FROM operations").get() as { c: number };
  if (count.c > 0) {
    return { migrated: 0, errors: 0 };
  }

  // Count JSONL files to migrate
  let totalFiles = 0;
  for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(OPERATIONS_DIR, entry.name);
    totalFiles += fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length;
  }

  if (totalFiles === 0) {
    return { migrated: 0, errors: 0 };
  }

  console.log(`[migrate-jsonl] Found ${totalFiles} legacy JSONL file(s), migration needed`);
  console.log(`[migrate-jsonl] Starting migration...`);

  let migrated = 0;
  let errors = 0;

  const insertOp = db.prepare(`
    INSERT OR IGNORE INTO operations (id, type, workspace, status, started_at, completed_at, children_json, phases_json, inputs_json, result_summary)
    VALUES ($id, $type, $workspace, $status, $started_at, $completed_at, $children_json, $phases_json, $inputs_json, $result_summary)
  `);

  const insertEvent = db.prepare(`
    INSERT INTO operation_events (operation_id, type, data, timestamp, child_label, phase_index, phase_label)
    VALUES ($operation_id, $type, $data, $timestamp, $child_label, $phase_index, $phase_label)
  `);

  for (const entry of fs.readdirSync(OPERATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(OPERATIONS_DIR, entry.name);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      const fp = path.join(dir, file);
      try {
        const log = readJsonlFile(fp);
        if (!log) {
          errors++;
          continue;
        }

        const { operation, events } = log;
        const resultSummary = extractLastResult(events);

        // Insert in a transaction per operation
        db.transaction(() => {
          insertOp.run({
            $id: operation.id,
            $type: operation.type,
            $workspace: operation.workspace,
            $status: operation.status,
            $started_at: operation.startedAt,
            $completed_at: operation.completedAt ?? null,
            $children_json: operation.children ? JSON.stringify(operation.children) : null,
            $phases_json: operation.phases ? JSON.stringify(operation.phases) : null,
            $inputs_json: operation.inputs ? JSON.stringify(operation.inputs) : null,
            $result_summary: resultSummary ? JSON.stringify(resultSummary) : null,
          });

          for (const event of events) {
            insertEvent.run({
              $operation_id: event.operationId,
              $type: event.type,
              $data: event.data,
              $timestamp: event.timestamp,
              $child_label: event.childLabel ?? null,
              $phase_index: event.phaseIndex ?? null,
              $phase_label: event.phaseLabel ?? null,
            });
          }
        })();

        // Delete the original file
        fs.unlinkSync(fp);
        migrated++;
      } catch (err) {
        console.warn(`[migrate-jsonl] Failed to migrate ${fp}:`, err);
        errors++;
      }
    }

    // Remove directory if empty
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
      }
    } catch {
      // ignore
    }
  }

  // Remove .operations/ if empty
  try {
    const remaining = fs.readdirSync(OPERATIONS_DIR);
    if (remaining.length === 0) {
      fs.rmdirSync(OPERATIONS_DIR);
    }
  } catch {
    // ignore
  }

  console.log(`[migrate-jsonl] Migration complete: ${migrated} migrated, ${errors} error(s)`);

  return { migrated, errors };
}
