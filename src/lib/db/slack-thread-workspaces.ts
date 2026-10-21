import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

/**
 * Which workspace a Slack thread works in, keyed like the conversation
 * sessions (`thread_ts ?? ts`). Kept apart from `slack_conversation_sessions`
 * and given no TTL: a session expires after a couple of idle hours, and the
 * thread still belongs to its workspace when it is picked up again.
 *
 * `turn_started_at` is set while the Slack bot runs a turn of the thread's
 * conversation, so the WebUI chat does not resume the same CLI session under
 * it. It lives here rather than on the session row because a thread's first
 * turn has no session yet.
 */

let _upsert: Statement | null = null;
let _get: Statement | null = null;
let _findByWorkspace: Statement | null = null;
let _setTurn: Statement | null = null;
let _getTurn: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO slack_thread_workspaces (thread_key, workspace, permalink)
      VALUES ($thread_key, $workspace, $permalink)
      ON CONFLICT(thread_key) DO UPDATE SET
        workspace = excluded.workspace,
        permalink = excluded.permalink,
        created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        turn_started_at = NULL
    `);
  }
  if (!_get) {
    _get = db.prepare("SELECT workspace FROM slack_thread_workspaces WHERE thread_key = ?");
  }
  if (!_findByWorkspace) {
    _findByWorkspace = db.prepare(
      "SELECT thread_key, permalink FROM slack_thread_workspaces WHERE workspace = ? ORDER BY created_at DESC LIMIT 1",
    );
  }
  if (!_setTurn) {
    _setTurn = db.prepare("UPDATE slack_thread_workspaces SET turn_started_at = $at WHERE thread_key = $thread_key");
  }
  if (!_getTurn) {
    _getTurn = db.prepare("SELECT turn_started_at FROM slack_thread_workspaces WHERE thread_key = ?");
  }
  return { upsert: _upsert, get: _get, findByWorkspace: _findByWorkspace, setTurn: _setTurn, getTurn: _getTurn };
}

/** Reset cached statements (needed when the DB is reset in tests). */
export function _resetSlackThreadWorkspaceStatements(): void {
  _upsert = null;
  _get = null;
  _findByWorkspace = null;
  _setTurn = null;
  _getTurn = null;
}

_onDbReset(_resetSlackThreadWorkspaceStatements);

/** `permalink` links to the thread in Slack, for the WebUI to point back at it. */
export function bindThreadWorkspace(threadKey: string, workspace: string, permalink?: string): void {
  stmts(getDb()).upsert.run({ $thread_key: threadKey, $workspace: workspace, $permalink: permalink ?? null });
}

export function getThreadWorkspace(threadKey: string): string | undefined {
  const row = stmts(getDb()).get.get(threadKey) as { workspace: string } | null;
  return row?.workspace;
}

/** The thread most recently bound to `workspace`. */
export function findWorkspaceThread(workspace: string): { threadKey: string; permalink?: string } | undefined {
  const row = stmts(getDb()).findByWorkspace.get(workspace) as { thread_key: string; permalink: string | null } | null;
  if (!row) return undefined;
  return { threadKey: row.thread_key, ...(row.permalink && { permalink: row.permalink }) };
}

export function startThreadTurn(threadKey: string, now: number): void {
  stmts(getDb()).setTurn.run({ $thread_key: threadKey, $at: now });
}

export function endThreadTurn(threadKey: string): void {
  stmts(getDb()).setTurn.run({ $thread_key: threadKey, $at: null });
}

/** When the thread's running turn started; undefined when none is running. */
export function getThreadTurnStartedAt(threadKey: string): number | undefined {
  const row = stmts(getDb()).getTurn.get(threadKey) as { turn_started_at: number | null } | null;
  return row?.turn_started_at ?? undefined;
}
