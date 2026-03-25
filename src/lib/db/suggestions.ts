import type { Database, Statement } from "bun:sqlite";
import { getDb, _onDbReset } from "./connection";
import type { WorkspaceSuggestion } from "@/types/suggestion";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _insert: Statement | null = null;
let _listActive: Statement | null = null;
let _dismiss: Statement | null = null;
let _get: Statement | null = null;
let _prune: Statement | null = null;

function stmts(db: Database) {
  if (!_insert) {
    _insert = db.prepare(`
      INSERT INTO workspace_suggestions (id, source_workspace, source_operation_id, target_repository, title, description)
      VALUES ($id, $sourceWorkspace, $sourceOperationId, $targetRepository, $title, $description)
    `);
  }
  if (!_listActive) {
    _listActive = db.prepare(
      "SELECT * FROM workspace_suggestions WHERE dismissed = 0 ORDER BY created_at DESC",
    );
  }
  if (!_dismiss) {
    _dismiss = db.prepare(
      "UPDATE workspace_suggestions SET dismissed = 1 WHERE id = ?",
    );
  }
  if (!_get) {
    _get = db.prepare("SELECT * FROM workspace_suggestions WHERE id = ?");
  }
  if (!_prune) {
    _prune = db.prepare(
      "DELETE FROM workspace_suggestions WHERE created_at < datetime('now', '-' || ? || ' days')",
    );
  }
  return { insert: _insert, listActive: _listActive, dismiss: _dismiss, get: _get, prune: _prune };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetSuggestionStatements(): void {
  _insert = null;
  _listActive = null;
  _dismiss = null;
  _get = null;
  _prune = null;
}

_onDbReset(_resetSuggestionStatements);

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface SuggestionRow {
  id: string;
  source_workspace: string;
  source_operation_id: string;
  target_repository: string;
  title: string;
  description: string;
  dismissed: number;
  created_at: string;
}

function rowToDomain(row: SuggestionRow): WorkspaceSuggestion {
  return {
    id: row.id,
    sourceWorkspace: row.source_workspace,
    sourceOperationId: row.source_operation_id,
    targetRepository: row.target_repository,
    title: row.title,
    description: row.description,
    dismissed: row.dismissed === 1,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function insertSuggestion(s: {
  id: string;
  sourceWorkspace: string;
  sourceOperationId: string;
  targetRepository: string;
  title: string;
  description: string;
}): void {
  const db = getDb();
  const st = stmts(db);
  st.insert.run({
    $id: s.id,
    $sourceWorkspace: s.sourceWorkspace,
    $sourceOperationId: s.sourceOperationId,
    $targetRepository: s.targetRepository,
    $title: s.title,
    $description: s.description,
  });
}

export function listActiveSuggestions(): WorkspaceSuggestion[] {
  const db = getDb();
  const st = stmts(db);
  const rows = st.listActive.all() as SuggestionRow[];
  return rows.map(rowToDomain);
}

export function dismissSuggestion(id: string): boolean {
  const db = getDb();
  const st = stmts(db);
  const result = st.dismiss.run(id);
  return result.changes > 0;
}

export function getSuggestion(id: string): WorkspaceSuggestion | null {
  const db = getDb();
  const st = stmts(db);
  const row = st.get.get(id) as SuggestionRow | null;
  return row ? rowToDomain(row) : null;
}

/** Delete suggestions older than `days` days. Returns number of deleted rows. */
export function pruneSuggestions(days: number): number {
  const db = getDb();
  const st = stmts(db);
  const result = st.prune.run(days);
  return result.changes;
}
