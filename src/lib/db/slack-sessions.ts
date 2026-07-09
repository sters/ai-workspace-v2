import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

/**
 * Persistence for the Slack conversation feature's `thread_key → Claude CLI
 * session_id` mapping. Persisting to SQLite (rather than an in-memory Map) lets
 * a thread's conversation survive a slack-server restart, since the CLI session
 * itself lives on disk under `~/.claude`.
 *
 * TTL / cap defaults match the previous in-memory behavior. `now` is injected
 * (rather than read from the clock) so eviction and expiry are unit-testable.
 */

/** How long a thread's session is kept before it is considered stale. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Cap on tracked threads to bound the table; oldest is evicted past this. */
export const MAX_SESSIONS = 200;

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _upsert: Statement | null = null;
let _get: Statement | null = null;
let _pruneExpired: Statement | null = null;
let _delete: Statement | null = null;
let _count: Statement | null = null;
let _evict: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO slack_conversation_sessions (thread_key, session_id, last_active)
      VALUES ($thread_key, $session_id, $last_active)
      ON CONFLICT(thread_key) DO UPDATE SET
        session_id = excluded.session_id,
        last_active = excluded.last_active
    `);
  }
  if (!_get) {
    _get = db.prepare(
      "SELECT session_id FROM slack_conversation_sessions WHERE thread_key = ?",
    );
  }
  if (!_pruneExpired) {
    // Expired = idle strictly longer than the TTL: last_active < now - ttl.
    _pruneExpired = db.prepare(
      "DELETE FROM slack_conversation_sessions WHERE last_active < ?",
    );
  }
  if (!_delete) {
    _delete = db.prepare("DELETE FROM slack_conversation_sessions WHERE thread_key = ?");
  }
  if (!_count) {
    _count = db.prepare("SELECT COUNT(*) AS n FROM slack_conversation_sessions");
  }
  if (!_evict) {
    // Drop the `?` oldest rows (smallest last_active) to get back under cap.
    _evict = db.prepare(`
      DELETE FROM slack_conversation_sessions
      WHERE thread_key IN (
        SELECT thread_key FROM slack_conversation_sessions
        ORDER BY last_active ASC
        LIMIT ?
      )
    `);
  }
  return {
    upsert: _upsert,
    get: _get,
    pruneExpired: _pruneExpired,
    delete: _delete,
    count: _count,
    evict: _evict,
  };
}

/** Reset cached statements (needed when the DB is reset in tests). */
export function _resetSlackSessionStatements(): void {
  _upsert = null;
  _get = null;
  _pruneExpired = null;
  _delete = null;
  _count = null;
  _evict = null;
}

_onDbReset(_resetSlackSessionStatements);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the live session id for a thread, or undefined if absent/expired. */
export function getSession(
  threadKey: string,
  now: number,
  ttlMs: number = SESSION_TTL_MS,
): string | undefined {
  const db = getDb();
  const s = stmts(db);
  s.pruneExpired.run(now - ttlMs);
  const row = s.get.get(threadKey) as { session_id: string } | null;
  return row?.session_id;
}

/** Record (or refresh) the session id for a thread. */
export function setSession(
  threadKey: string,
  sessionId: string,
  now: number,
  ttlMs: number = SESSION_TTL_MS,
  maxEntries: number = MAX_SESSIONS,
): void {
  const db = getDb();
  const s = stmts(db);
  s.pruneExpired.run(now - ttlMs);
  s.upsert.run({
    $thread_key: threadKey,
    $session_id: sessionId,
    $last_active: now,
  });
  const { n } = s.count.get() as { n: number };
  if (n > maxEntries) s.evict.run(n - maxEntries);
}

/** Remove a thread's session mapping. Idempotent. */
export function deleteSession(threadKey: string): void {
  const db = getDb();
  stmts(db).delete.run(threadKey);
}

/** Number of tracked threads (mainly for tests). */
export function countSessions(): number {
  const db = getDb();
  return (stmts(db).count.get() as { n: number }).n;
}
