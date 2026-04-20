import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";
import type { Snippet } from "@/types/snippet";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _insert: Statement | null = null;
let _update: Statement | null = null;
let _delete: Statement | null = null;
let _get: Statement | null = null;
let _list: Statement | null = null;

function stmts(db: Database) {
  if (!_insert) {
    _insert = db.prepare(`
      INSERT INTO snippets (title, content)
      VALUES ($title, $content)
    `);
  }
  if (!_update) {
    _update = db.prepare(`
      UPDATE snippets
      SET title = $title, content = $content, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $id
    `);
  }
  if (!_delete) {
    _delete = db.prepare("DELETE FROM snippets WHERE id = ?");
  }
  if (!_get) {
    _get = db.prepare("SELECT * FROM snippets WHERE id = ?");
  }
  if (!_list) {
    _list = db.prepare(
      "SELECT * FROM snippets ORDER BY updated_at DESC, id DESC",
    );
  }
  return { insert: _insert, update: _update, delete: _delete, get: _get, list: _list };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetSnippetStatements(): void {
  _insert = null;
  _update = null;
  _delete = null;
  _get = null;
  _list = null;
}

_onDbReset(_resetSnippetStatements);

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface SnippetRow {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: SnippetRow): Snippet {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function insertSnippet(s: { title: string; content: string }): Snippet {
  const db = getDb();
  const st = stmts(db);
  const result = st.insert.run({ $title: s.title, $content: s.content });
  const row = st.get.get(Number(result.lastInsertRowid)) as SnippetRow;
  return rowToDomain(row);
}

export function updateSnippet(
  id: number,
  s: { title: string; content: string },
): Snippet | null {
  const db = getDb();
  const st = stmts(db);
  const result = st.update.run({ $id: id, $title: s.title, $content: s.content });
  if (result.changes === 0) return null;
  const row = st.get.get(id) as SnippetRow | null;
  return row ? rowToDomain(row) : null;
}

export function deleteSnippet(id: number): boolean {
  const db = getDb();
  const st = stmts(db);
  const result = st.delete.run(id);
  return result.changes > 0;
}

export function getSnippet(id: number): Snippet | null {
  const db = getDb();
  const st = stmts(db);
  const row = st.get.get(id) as SnippetRow | null;
  return row ? rowToDomain(row) : null;
}

export function listSnippets(): Snippet[] {
  const db = getDb();
  const st = stmts(db);
  const rows = st.list.all() as SnippetRow[];
  return rows.map(rowToDomain);
}
