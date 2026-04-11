import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _archive: Statement | null = null;
let _unarchive: Statement | null = null;
let _isArchived: Statement | null = null;
let _listArchived: Statement | null = null;
let _listArchivedSet: Statement | null = null;

function stmts(db: Database) {
  if (!_archive) {
    _archive = db.prepare(
      "INSERT OR IGNORE INTO workspace_archives (name) VALUES (?)",
    );
  }
  if (!_unarchive) {
    _unarchive = db.prepare("DELETE FROM workspace_archives WHERE name = ?");
  }
  if (!_isArchived) {
    _isArchived = db.prepare(
      "SELECT 1 FROM workspace_archives WHERE name = ?",
    );
  }
  if (!_listArchived) {
    _listArchived = db.prepare(
      "SELECT name, archived_at FROM workspace_archives ORDER BY archived_at DESC",
    );
  }
  if (!_listArchivedSet) {
    _listArchivedSet = db.prepare(
      "SELECT name FROM workspace_archives",
    );
  }
  return {
    archive: _archive,
    unarchive: _unarchive,
    isArchived: _isArchived,
    listArchived: _listArchived,
    listArchivedSet: _listArchivedSet,
  };
}

export function _resetArchiveStatements(): void {
  _archive = null;
  _unarchive = null;
  _isArchived = null;
  _listArchived = null;
  _listArchivedSet = null;
}

_onDbReset(_resetArchiveStatements);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function archiveWorkspace(name: string): void {
  const db = getDb();
  stmts(db).archive.run(name);
}

export function unarchiveWorkspace(name: string): void {
  const db = getDb();
  stmts(db).unarchive.run(name);
}

export function isWorkspaceArchived(name: string): boolean {
  const db = getDb();
  return stmts(db).isArchived.get(name) != null;
}

export interface ArchivedWorkspace {
  name: string;
  archivedAt: string;
}

export function listArchivedWorkspaces(): ArchivedWorkspace[] {
  const db = getDb();
  const rows = stmts(db).listArchived.all() as {
    name: string;
    archived_at: string;
  }[];
  return rows.map((r) => ({ name: r.name, archivedAt: r.archived_at }));
}

/** Returns a Set of archived workspace names for efficient lookup during listing. */
export function getArchivedNameSet(): Set<string> {
  const db = getDb();
  const rows = stmts(db).listArchivedSet.all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}
