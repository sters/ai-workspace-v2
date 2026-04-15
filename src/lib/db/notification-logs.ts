import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _insert: Statement | null = null;
let _list: Statement | null = null;
let _count: Statement | null = null;

function stmts(db: Database) {
  if (!_insert) {
    _insert = db.prepare(`
      INSERT INTO notification_logs (title, body, tag, url, endpoint, success, error_message)
      VALUES ($title, $body, $tag, $url, $endpoint, $success, $errorMessage)
    `);
  }
  if (!_list) {
    _list = db.prepare(
      "SELECT id, title, body, tag, url, endpoint, success, error_message, created_at FROM notification_logs ORDER BY created_at DESC LIMIT $limit OFFSET $offset",
    );
  }
  if (!_count) {
    _count = db.prepare("SELECT COUNT(*) as total FROM notification_logs");
  }
  return { insert: _insert, list: _list, count: _count };
}

export function _resetNotificationLogStatements(): void {
  _insert = null;
  _list = null;
  _count = null;
}

_onDbReset(_resetNotificationLogStatements);

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface NotificationLogRow {
  id: number;
  title: string;
  body: string;
  tag: string;
  url: string;
  endpoint: string;
  success: number;
  error_message: string | null;
  created_at: string;
}

export interface NotificationLog {
  id: number;
  title: string;
  body: string;
  tag: string;
  url: string;
  endpoint: string;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function insertNotificationLog(entry: {
  title: string;
  body: string;
  tag: string;
  url: string;
  endpoint: string;
  success: boolean;
  errorMessage?: string | null;
}): void {
  const db = getDb();
  const s = stmts(db);
  s.insert.run({
    $title: entry.title,
    $body: entry.body,
    $tag: entry.tag,
    $url: entry.url,
    $endpoint: entry.endpoint,
    $success: entry.success ? 1 : 0,
    $errorMessage: entry.errorMessage ?? null,
  });
}

export function getNotificationLogs(
  limit = 50,
  offset = 0,
): { logs: NotificationLog[]; total: number } {
  const db = getDb();
  const s = stmts(db);
  const rows = s.list.all({ $limit: limit, $offset: offset }) as NotificationLogRow[];
  const { total } = s.count.get() as { total: number };
  return {
    logs: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      tag: row.tag,
      url: row.url,
      endpoint: row.endpoint,
      success: row.success === 1,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
    total,
  };
}
