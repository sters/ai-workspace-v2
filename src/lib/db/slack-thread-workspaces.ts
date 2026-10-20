import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

/**
 * Which workspace a Slack thread works in, keyed like the conversation
 * sessions (`thread_ts ?? ts`). Kept apart from `slack_conversation_sessions`
 * and given no TTL: a session expires after a couple of idle hours, and the
 * thread still belongs to its workspace when it is picked up again.
 */

let _upsert: Statement | null = null;
let _get: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO slack_thread_workspaces (thread_key, workspace)
      VALUES ($thread_key, $workspace)
      ON CONFLICT(thread_key) DO UPDATE SET
        workspace = excluded.workspace,
        created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
  }
  if (!_get) {
    _get = db.prepare("SELECT workspace FROM slack_thread_workspaces WHERE thread_key = ?");
  }
  return { upsert: _upsert, get: _get };
}

/** Reset cached statements (needed when the DB is reset in tests). */
export function _resetSlackThreadWorkspaceStatements(): void {
  _upsert = null;
  _get = null;
}

_onDbReset(_resetSlackThreadWorkspaceStatements);

export function bindThreadWorkspace(threadKey: string, workspace: string): void {
  stmts(getDb()).upsert.run({ $thread_key: threadKey, $workspace: workspace });
}

export function getThreadWorkspace(threadKey: string): string | undefined {
  const row = stmts(getDb()).get.get(threadKey) as { workspace: string } | null;
  return row?.workspace;
}
