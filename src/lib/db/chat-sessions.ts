import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _upsert: Statement | null = null;
let _markExited: Statement | null = null;
let _getById: Statement | null = null;
let _deleteById: Statement | null = null;
let _markAllExited: Statement | null = null;

function stmts(db: Database) {
  if (!_upsert) {
    _upsert = db.prepare(`
      INSERT INTO chat_sessions (id, workspace_id, started_at)
      VALUES ($id, $workspace_id, $started_at)
      ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, started_at = excluded.started_at
    `);
  }
  if (!_markExited) {
    _markExited = db.prepare(`
      UPDATE chat_sessions SET exited = 1, exit_code = $exit_code, exited_at = $exited_at WHERE id = $id
    `);
  }
  if (!_getById) {
    _getById = db.prepare("SELECT * FROM chat_sessions WHERE id = ?");
  }
  if (!_deleteById) {
    _deleteById = db.prepare("DELETE FROM chat_sessions WHERE id = ?");
  }
  if (!_markAllExited) {
    _markAllExited = db.prepare(`
      UPDATE chat_sessions SET exited = 1, exited_at = $exited_at WHERE exited = 0
    `);
  }
  return {
    upsert: _upsert,
    markExited: _markExited,
    getById: _getById,
    deleteById: _deleteById,
    markAllExited: _markAllExited,
  };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetChatStatements(): void {
  _upsert = null;
  _markExited = null;
  _getById = null;
  _deleteById = null;
  _markAllExited = null;
}

_onDbReset(_resetChatStatements);

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface ChatSessionRow {
  id: string;
  workspace_id: string;
  started_at: number;
  exited: number;
  exit_code: number | null;
  exited_at: number | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function upsertChatSession(meta: {
  id: string;
  workspaceId: string;
  startedAt: number;
}): void {
  const db = getDb();
  const s = stmts(db);
  s.upsert.run({
    $id: meta.id,
    $workspace_id: meta.workspaceId,
    $started_at: meta.startedAt,
  });
}

export function markChatSessionExited(
  id: string,
  exitCode: number | null,
): void {
  const db = getDb();
  const s = stmts(db);
  s.markExited.run({
    $id: id,
    $exit_code: exitCode,
    $exited_at: Date.now(),
  });
}

export function getChatSession(id: string): {
  id: string;
  workspaceId: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  exitedAt: number | null;
} | null {
  const db = getDb();
  const s = stmts(db);
  const row = s.getById.get(id) as ChatSessionRow | null;
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    startedAt: row.started_at,
    exited: row.exited === 1,
    exitCode: row.exit_code,
    exitedAt: row.exited_at,
  };
}

export function deleteChatSession(id: string): void {
  const db = getDb();
  const s = stmts(db);
  s.deleteById.run(id);
}

export function markAllSessionsExited(): void {
  const db = getDb();
  const s = stmts(db);
  s.markAllExited.run({ $exited_at: Date.now() });
}
