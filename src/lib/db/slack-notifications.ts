import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

let _upsert: Statement | null = null;
let _listReady: Statement | null = null;
let _listUnannounced: Statement | null = null;
let _setHeader: Statement | null = null;
let _delete: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    // Re-dispatching the same operation overwrites the channel/thread mapping.
    _upsert = db.prepare(`
      INSERT INTO slack_pending_notifications (operation_id, channel, thread_ts, message_ts, status_header)
      VALUES ($operation_id, $channel, $thread_ts, $message_ts, $status_header)
      ON CONFLICT(operation_id) DO UPDATE SET
        channel = excluded.channel,
        thread_ts = excluded.thread_ts,
        message_ts = excluded.message_ts,
        status_header = excluded.status_header,
        created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
  }
  if (!_listReady) {
    // Join with operations and only return rows whose operation has finished.
    _listReady = db.prepare(`
      SELECT sp.operation_id, sp.channel, sp.thread_ts, sp.message_ts, sp.status_header, op.status, op.workspace
      FROM slack_pending_notifications sp
      JOIN operations op ON op.id = sp.operation_id
      WHERE op.status IN ('completed', 'failed')
      ORDER BY sp.created_at ASC
    `);
  }
  if (!_listUnannounced) {
    _listUnannounced = db.prepare(`
      SELECT sp.operation_id, sp.channel, sp.thread_ts, sp.message_ts, op.workspace
      FROM slack_pending_notifications sp
      JOIN operations op ON op.id = sp.operation_id
      WHERE op.status = 'running'
        AND op.workspace != ''
        AND sp.message_ts IS NOT NULL
        AND sp.status_header IS NULL
      ORDER BY sp.created_at ASC
    `);
  }
  if (!_setHeader) {
    _setHeader = db.prepare(
      "UPDATE slack_pending_notifications SET status_header = $status_header WHERE operation_id = $operation_id",
    );
  }
  if (!_delete) {
    _delete = db.prepare("DELETE FROM slack_pending_notifications WHERE operation_id = ?");
  }
  return {
    upsert: _upsert,
    listReady: _listReady,
    listUnannounced: _listUnannounced,
    setHeader: _setHeader,
    delete: _delete,
  };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetSlackNotificationStatements(): void {
  _upsert = null;
  _listReady = null;
  _listUnannounced = null;
  _setHeader = null;
  _delete = null;
}

_onDbReset(_resetSlackNotificationStatements);

export interface PendingNotification {
  operationId: string;
  channel: string;
  threadTs: string;
  /** The thread's status message, edited in place as the run progresses. */
  messageTs?: string;
  /** First part of the status message, kept above the changing status line. Unset until the workspace is known. */
  statusHeader?: string;
}

export interface ReadyNotification extends PendingNotification {
  status: "completed" | "failed";
  /** The operation's workspace, `""` when it never got one. */
  workspace: string;
}

export interface UnannouncedWorkspace {
  operationId: string;
  channel: string;
  threadTs: string;
  messageTs: string;
  workspace: string;
}

/** Insert (or replace) a pending notification mapping. */
export function addPendingNotification(p: PendingNotification): void {
  const db = getDb();
  const s = stmts(db);
  s.upsert.run({
    $operation_id: p.operationId,
    $channel: p.channel,
    $thread_ts: p.threadTs,
    $message_ts: p.messageTs ?? null,
    $status_header: p.statusHeader ?? null,
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
    message_ts: string | null;
    status_header: string | null;
    status: string;
    workspace: string;
  }>;
  return rows.map((r) => ({
    operationId: r.operation_id,
    channel: r.channel,
    threadTs: r.thread_ts,
    ...(r.message_ts !== null && { messageTs: r.message_ts }),
    ...(r.status_header !== null && { statusHeader: r.status_header }),
    status: r.status as "completed" | "failed",
    workspace: r.workspace,
  }));
}

/**
 * Running operations that have a status message and now a workspace, but whose
 * message does not say so yet. Setting the header with {@link setStatusHeader}
 * takes a row off this list.
 */
export function listUnannouncedWorkspaces(): UnannouncedWorkspace[] {
  const db = getDb();
  const s = stmts(db);
  const rows = s.listUnannounced.all() as Array<{
    operation_id: string;
    channel: string;
    thread_ts: string;
    message_ts: string;
    workspace: string;
  }>;
  return rows.map((r) => ({
    operationId: r.operation_id,
    channel: r.channel,
    threadTs: r.thread_ts,
    messageTs: r.message_ts,
    workspace: r.workspace,
  }));
}

export function setStatusHeader(operationId: string, header: string): void {
  const db = getDb();
  const s = stmts(db);
  s.setHeader.run({ $operation_id: operationId, $status_header: header });
}

/** Remove a pending notification. Idempotent. */
export function deleteNotification(operationId: string): void {
  const db = getDb();
  const s = stmts(db);
  s.delete.run(operationId);
}
