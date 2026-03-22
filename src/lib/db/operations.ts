import type { Database, Statement } from "bun:sqlite";
import type { Operation, OperationListItem } from "@/types/operation";
import type { OperationLogAgeInfo } from "@/lib/operation-store/types";
import { getDb, _onDbReset } from "./connection";

// ---------------------------------------------------------------------------
// Lazy prepared statements
// ---------------------------------------------------------------------------

let _insert: Statement | null = null;
let _updateStatus: Statement | null = null;
let _updateWorkspace: Statement | null = null;
let _updateMeta: Statement | null = null;
let _getById: Statement | null = null;
let _list: Statement | null = null;
let _listByWorkspace: Statement | null = null;
let _listByStatus: Statement | null = null;
let _deleteById: Statement | null = null;
let _deleteByWorkspace: Statement | null = null;
let _listWithAge: Statement | null = null;

function stmts(db: Database) {
  if (!_insert) {
    _insert = db.prepare(`
      INSERT INTO operations (id, type, workspace, status, started_at, completed_at, children_json, phases_json, inputs_json, result_summary)
      VALUES ($id, $type, $workspace, $status, $started_at, $completed_at, $children_json, $phases_json, $inputs_json, $result_summary)
    `);
  }
  if (!_updateStatus) {
    _updateStatus = db.prepare(`
      UPDATE operations SET status = $status, completed_at = $completed_at WHERE id = $id
    `);
  }
  if (!_updateWorkspace) {
    _updateWorkspace = db.prepare(
      "UPDATE operations SET workspace = $workspace WHERE id = $id",
    );
  }
  if (!_updateMeta) {
    _updateMeta = db.prepare(`
      UPDATE operations SET
        children_json = COALESCE($children_json, children_json),
        phases_json = COALESCE($phases_json, phases_json),
        result_summary = COALESCE($result_summary, result_summary)
      WHERE id = $id
    `);
  }
  if (!_getById) {
    _getById = db.prepare("SELECT * FROM operations WHERE id = ?");
  }
  if (!_list) {
    _list = db.prepare("SELECT * FROM operations ORDER BY started_at DESC");
  }
  if (!_listByWorkspace) {
    _listByWorkspace = db.prepare(
      "SELECT * FROM operations WHERE workspace = ? ORDER BY started_at DESC",
    );
  }
  if (!_listByStatus) {
    _listByStatus = db.prepare(
      "SELECT * FROM operations WHERE status = ? ORDER BY started_at DESC",
    );
  }
  if (!_deleteById) {
    _deleteById = db.prepare("DELETE FROM operations WHERE id = ?");
  }
  if (!_deleteByWorkspace) {
    _deleteByWorkspace = db.prepare("DELETE FROM operations WHERE workspace = ?");
  }
  if (!_listWithAge) {
    _listWithAge = db.prepare(
      "SELECT id, type, workspace, started_at FROM operations ORDER BY started_at ASC",
    );
  }
  return {
    insert: _insert,
    updateStatus: _updateStatus,
    updateWorkspace: _updateWorkspace,
    updateMeta: _updateMeta,
    getById: _getById,
    list: _list,
    listByWorkspace: _listByWorkspace,
    listByStatus: _listByStatus,
    deleteById: _deleteById,
    deleteByWorkspace: _deleteByWorkspace,
    listWithAge: _listWithAge,
  };
}

/** Reset cached statements (needed when DB is reset in tests). */
export function _resetStatements(): void {
  _insert = null;
  _updateStatus = null;
  _updateWorkspace = null;
  _updateMeta = null;
  _getById = null;
  _list = null;
  _listByWorkspace = null;
  _listByStatus = null;
  _deleteById = null;
  _deleteByWorkspace = null;
  _listWithAge = null;
}

_onDbReset(_resetStatements);

// ---------------------------------------------------------------------------
// Safe JSON parsing helper
// ---------------------------------------------------------------------------

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Row ↔ Domain conversions
// ---------------------------------------------------------------------------

interface OperationRow {
  id: string;
  type: string;
  workspace: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  children_json: string | null;
  phases_json: string | null;
  inputs_json: string | null;
  result_summary: string | null;
}

function rowToOperation(row: OperationRow): Operation {
  return {
    id: row.id,
    type: row.type as Operation["type"],
    workspace: row.workspace,
    status: row.status as Operation["status"],
    startedAt: row.started_at,
    ...(row.completed_at && { completedAt: row.completed_at }),
    ...(row.children_json && { children: safeJsonParse(row.children_json, []) }),
    ...(row.phases_json && { phases: safeJsonParse(row.phases_json, []) }),
    ...(row.inputs_json && { inputs: safeJsonParse(row.inputs_json, {}) }),
  };
}

function rowToListItem(row: OperationRow): OperationListItem {
  return {
    id: row.id,
    type: row.type as Operation["type"],
    workspace: row.workspace,
    status: row.status as Operation["status"],
    startedAt: row.started_at,
    ...(row.completed_at && { completedAt: row.completed_at }),
    ...(row.inputs_json && { inputs: safeJsonParse(row.inputs_json, {}) }),
    ...(row.result_summary && { resultSummary: safeJsonParse<OperationListItem["resultSummary"]>(row.result_summary, undefined) }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function insertOperation(op: Operation): void {
  const db = getDb();
  const s = stmts(db);
  s.insert.run({
    $id: op.id,
    $type: op.type,
    $workspace: op.workspace,
    $status: op.status,
    $started_at: op.startedAt,
    $completed_at: op.completedAt ?? null,
    $children_json: op.children ? JSON.stringify(op.children) : null,
    $phases_json: op.phases ? JSON.stringify(op.phases) : null,
    $inputs_json: op.inputs ? JSON.stringify(op.inputs) : null,
    $result_summary: null,
  });
}

export function updateOperationStatus(
  id: string,
  status: Operation["status"],
  completedAt?: string,
): void {
  const db = getDb();
  const s = stmts(db);
  s.updateStatus.run({
    $id: id,
    $status: status,
    $completed_at: completedAt ?? null,
  });
}

export function updateOperationWorkspace(id: string, workspace: string): void {
  const db = getDb();
  const s = stmts(db);
  s.updateWorkspace.run({ $id: id, $workspace: workspace });
}

export function updateOperationMeta(
  id: string,
  meta: {
    children?: Operation["children"];
    phases?: Operation["phases"];
    resultSummary?: { content: string; cost?: string; duration?: string };
  },
): void {
  const db = getDb();
  const s = stmts(db);
  s.updateMeta.run({
    $id: id,
    $children_json: meta.children ? JSON.stringify(meta.children) : null,
    $phases_json: meta.phases ? JSON.stringify(meta.phases) : null,
    $result_summary: meta.resultSummary ? JSON.stringify(meta.resultSummary) : null,
  });
}

export function getOperation(id: string): Operation | null {
  const db = getDb();
  const s = stmts(db);
  const row = s.getById.get(id) as OperationRow | null;
  return row ? rowToOperation(row) : null;
}

export function listOperations(workspace?: string): OperationListItem[] {
  const db = getDb();
  const s = stmts(db);
  const rows = workspace
    ? (s.listByWorkspace.all(workspace) as OperationRow[])
    : (s.list.all() as OperationRow[]);
  return rows.map(rowToListItem);
}

export function listRunningOperations(): Operation[] {
  const db = getDb();
  const s = stmts(db);
  const rows = s.listByStatus.all("running") as OperationRow[];
  return rows.map(rowToOperation);
}

export function listOperationsWithAge(staleDays: number): OperationLogAgeInfo[] {
  const db = getDb();
  const s = stmts(db);
  const now = Date.now();
  const rows = s.listWithAge.all() as Array<{ id: string; type: string; workspace: string; started_at: string }>;

  return rows.map((row) => {
    const startedAtMs = new Date(row.started_at).getTime();
    const ageDays = Math.floor((now - startedAtMs) / (24 * 60 * 60 * 1000));
    return {
      operationId: row.id,
      workspace: row.workspace,
      type: row.type,
      startedAt: row.started_at,
      ageDays,
      isStale: ageDays >= staleDays,
    };
  });
}

export function deleteOperation(id: string): boolean {
  const db = getDb();
  const s = stmts(db);
  const result = s.deleteById.run(id);
  return result.changes > 0;
}

export function deleteOperationsForWorkspace(workspace: string): boolean {
  const db = getDb();
  const s = stmts(db);
  const result = s.deleteByWorkspace.run(workspace);
  return result.changes > 0;
}
