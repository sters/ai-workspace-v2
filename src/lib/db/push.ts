import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _upsert: Statement | null = null;
let _remove: Statement | null = null;
let _getAll: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth)
      VALUES ($endpoint, $p256dh, $auth)
    `);
  }
  if (!_remove) {
    _remove = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");
  }
  if (!_getAll) {
    _getAll = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions");
  }
  return { upsert: _upsert, remove: _remove, getAll: _getAll };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetPushStatements(): void {
  _upsert = null;
  _remove = null;
  _getAll = null;
}

_onDbReset(_resetPushStatements);

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function addPushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): void {
  const db = getDb();
  const s = stmts(db);
  s.upsert.run({
    $endpoint: sub.endpoint,
    $p256dh: sub.keys.p256dh,
    $auth: sub.keys.auth,
  });
}

export function removePushSubscription(endpoint: string): boolean {
  const db = getDb();
  const s = stmts(db);
  const result = s.remove.run(endpoint);
  return result.changes > 0;
}

export function getAllPushSubscriptions(): Array<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
}> {
  const db = getDb();
  const s = stmts(db);
  const rows = s.getAll.all() as PushRow[];
  return rows.map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }));
}
