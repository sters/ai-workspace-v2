import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE schema_migrations (
          version    INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE operations (
          id              TEXT PRIMARY KEY,
          type            TEXT NOT NULL,
          workspace       TEXT NOT NULL,
          status          TEXT NOT NULL,
          started_at      TEXT NOT NULL,
          completed_at    TEXT,
          children_json   TEXT,
          phases_json     TEXT,
          inputs_json     TEXT,
          result_summary  TEXT
        );
        CREATE INDEX idx_ops_workspace ON operations(workspace);
        CREATE INDEX idx_ops_started_at ON operations(started_at DESC);
        CREATE INDEX idx_ops_status ON operations(status);

        CREATE TABLE operation_events (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
          type         TEXT NOT NULL,
          data         TEXT NOT NULL,
          timestamp    TEXT NOT NULL,
          child_label  TEXT,
          phase_index  INTEGER,
          phase_label  TEXT
        );
        CREATE INDEX idx_events_op_id ON operation_events(operation_id);

        CREATE TABLE push_subscriptions (
          endpoint   TEXT PRIMARY KEY,
          p256dh     TEXT NOT NULL,
          auth       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        CREATE TABLE chat_sessions (
          id           TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          started_at   INTEGER NOT NULL,
          exited       INTEGER NOT NULL DEFAULT 0,
          exit_code    INTEGER,
          exited_at    INTEGER
        );
        CREATE INDEX idx_chat_workspace ON chat_sessions(workspace_id);
      `);
    },
  },
];

/**
 * Run all pending migrations in order.
 * Each migration runs inside a transaction.
 */
export function runMigrations(db: Database): void {
  // Check if schema_migrations table exists
  const tableExists = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();

  let currentVersion = 0;
  if (tableExists) {
    const row = db
      .query("SELECT MAX(version) as v FROM schema_migrations")
      .get() as { v: number | null } | null;
    currentVersion = row?.v ?? 0;
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    db.transaction(() => {
      migration.up(db);

      // For v1, schema_migrations table is created by the migration itself
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(
        migration.version,
      );
    })();
  }
}
