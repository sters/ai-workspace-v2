import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _upsert: Statement | null = null;
let _listReady: Statement | null = null;
let _delete: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    // Re-dispatching the same operation overwrites the channel/thread mapping.
    _upsert = db.prepare(`
      INSERT INTO slack_pending_notifications (operation_id, channel, thread_ts)
      VALUES ($operation_id, $channel, $thread_ts)
      ON CONFLICT(operation_id) DO UPDATE SET
        channel = excluded.channel,
        thread_ts = excluded.thread_ts,
        created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
  }
  if (!_listReady) {
    // Join with operations and only return rows whose operation has finished.
    _listReady = db.prepare(`
      SELECT sp.operation_id, sp.channel, sp.thread_ts, op.status
      FROM slack_pending_notifications sp
      JOIN operations op ON op.id = sp.operation_id
      WHERE op.status IN ('completed', 'failed')
      ORDER BY sp.created_at ASC
    `);
  }
  if (!_delete) {
    _delete = db.prepare("DELETE FROM slack_pending_notifications WHERE operation_id = ?");
  }
  return { upsert: _upsert, listReady: _listReady, delete: _delete };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetSlackNotificationStatements(): void {
  _upsert = null;
  _listReady = null;
  _delete = null;
}

_onDbReset(_resetSlackNotificationStatements);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PendingNotification {
  operationId: string;
  channel: string;
  threadTs: string;
}

export interface ReadyNotification extends PendingNotification {
  status: "completed" | "failed";
}

/** Insert (or replace) a pending notification mapping. */
export function addPendingNotification(p: PendingNotification): void {
  const db = getDb();
  const s = stmts(db);
  s.upsert.run({
    $operation_id: p.operationId,
    $channel: p.channel,
    $thread_ts: p.threadTs,
  });
}

/**
 * Return all pending notifications whose operation has reached `completed` or
 * `failed`. Ordered by insertion time so older mentions are processed first.
 */
export function listReadyNotifications(): ReadyNotification[] {
  const db = getDb();
  const s = stmts(db);
  const rows = s.listReady.all() as Array<{
    operation_id: string;
    channel: string;
    thread_ts: string;
    status: string;
  }>;
  return rows.map((r) => ({
    operationId: r.operation_id,
    channel: r.channel,
    threadTs: r.thread_ts,
    status: r.status as "completed" | "failed",
  }));
}

/** Remove a pending notification. Idempotent. */
export function deleteNotification(operationId: string): void {
  const db = getDb();
  const s = stmts(db);
  s.delete.run(operationId);
}
