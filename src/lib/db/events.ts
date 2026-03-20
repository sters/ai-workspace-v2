import type { Database, Statement } from "bun:sqlite";
import type { OperationEvent } from "@/types/operation";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _insertEvent: Statement | null = null;
let _getByOpId: Statement | null = null;

function stmts(db: Database) {
  if (!_insertEvent) {
    _insertEvent = db.prepare(`
      INSERT INTO operation_events (operation_id, type, data, timestamp, child_label, phase_index, phase_label)
      VALUES ($operation_id, $type, $data, $timestamp, $child_label, $phase_index, $phase_label)
    `);
  }
  if (!_getByOpId) {
    _getByOpId = db.prepare(
      "SELECT * FROM operation_events WHERE operation_id = ? ORDER BY id ASC",
    );
  }
  return { insertEvent: _insertEvent, getByOpId: _getByOpId };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetEventStatements(): void {
  _insertEvent = null;
  _getByOpId = null;
}

_onDbReset(_resetEventStatements);

// ---------------------------------------------------------------------------
// Row ↔ Domain
// ---------------------------------------------------------------------------

interface EventRow {
  id: number;
  operation_id: string;
  type: string;
  data: string;
  timestamp: string;
  child_label: string | null;
  phase_index: number | null;
  phase_label: string | null;
}

function rowToEvent(row: EventRow): OperationEvent {
  return {
    type: row.type as OperationEvent["type"],
    operationId: row.operation_id,
    data: row.data,
    timestamp: row.timestamp,
    ...(row.child_label != null && { childLabel: row.child_label }),
    ...(row.phase_index != null && { phaseIndex: row.phase_index }),
    ...(row.phase_label != null && { phaseLabel: row.phase_label }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append events to the database in a single transaction.
 */
export function appendEvents(events: OperationEvent[]): void {
  if (events.length === 0) return;

  const db = getDb();
  const s = stmts(db);

  db.transaction(() => {
    for (const event of events) {
      s.insertEvent.run({
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
}

/**
 * Get all events for an operation, ordered by insertion order.
 */
export function getEvents(operationId: string): OperationEvent[] {
  const db = getDb();
  const s = stmts(db);
  const rows = s.getByOpId.all(operationId) as EventRow[];
  return rows.map(rowToEvent);
}
