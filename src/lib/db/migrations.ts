import type { Database } from "bun:sqlite";
import { parseRunUsage } from "@/lib/parsers/run-usage";

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
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE workspace_suggestions (
          id                  TEXT PRIMARY KEY,
          source_workspace    TEXT NOT NULL,
          source_operation_id TEXT NOT NULL,
          title               TEXT NOT NULL,
          description         TEXT NOT NULL,
          dismissed           INTEGER NOT NULL DEFAULT 0,
          created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX idx_ws_sug_dismissed ON workspace_suggestions(dismissed);
        CREATE INDEX idx_ws_sug_source ON workspace_suggestions(source_workspace);
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        ALTER TABLE workspace_suggestions ADD COLUMN target_repository TEXT NOT NULL DEFAULT '';
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE workspace_archives (
          name        TEXT PRIMARY KEY,
          archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    },
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE notification_logs (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          title         TEXT NOT NULL,
          body          TEXT NOT NULL,
          tag           TEXT NOT NULL,
          url           TEXT NOT NULL,
          endpoint      TEXT NOT NULL,
          success       INTEGER NOT NULL,
          error_message TEXT,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX idx_notif_logs_created_at ON notification_logs(created_at DESC);
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      db.exec(`
        CREATE TABLE snippets (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          title      TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX idx_snippets_updated_at ON snippets(updated_at DESC);
      `);
    },
  },
  {
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE slack_pending_notifications (
          operation_id  TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE CASCADE,
          channel       TEXT NOT NULL,
          thread_ts     TEXT NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    },
  },
  {
    version: 8,
    up: (db) => {
      db.exec(`
        CREATE TABLE slack_conversation_sessions (
          thread_key  TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL,
          last_active INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 9,
    up: (db) => {
      db.exec(`
        CREATE TABLE chat_start_prompts (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          title      TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    },
  },
  {
    version: 10,
    up: (db) => {
      db.exec(`
        CREATE TABLE slack_thread_workspaces (
          thread_key TEXT PRIMARY KEY,
          workspace  TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    },
  },
  {
    version: 11,
    up: (db) => {
      db.exec(`
        ALTER TABLE slack_thread_workspaces ADD COLUMN turn_started_at INTEGER;
        CREATE INDEX idx_slack_thread_workspaces_workspace ON slack_thread_workspaces(workspace);
      `);
    },
  },
  {
    version: 12,
    up: (db) => {
      db.exec(`
        ALTER TABLE slack_thread_workspaces ADD COLUMN permalink TEXT;
      `);
    },
  },
  {
    version: 13,
    up: (db) => {
      db.exec(`
        ALTER TABLE slack_pending_notifications ADD COLUMN message_ts TEXT;
        ALTER TABLE slack_pending_notifications ADD COLUMN status_header TEXT;
      `);
    },
  },
  {
    version: 14,
    up: (db) => {
      // No foreign key to operations: the cost history outlives operation log pruning.
      db.exec(`
        CREATE TABLE claude_runs (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          operation_id          TEXT NOT NULL,
          operation_type        TEXT NOT NULL,
          workspace             TEXT NOT NULL,
          phase_label           TEXT,
          child_label           TEXT,
          step_type             TEXT,
          effort                TEXT,
          model                 TEXT,
          cost_usd              REAL NOT NULL,
          duration_ms           INTEGER NOT NULL,
          num_turns             INTEGER NOT NULL,
          input_tokens          INTEGER NOT NULL,
          cache_creation_tokens INTEGER NOT NULL,
          cache_read_tokens     INTEGER NOT NULL,
          output_tokens         INTEGER NOT NULL,
          created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX idx_claude_runs_created_at ON claude_runs(created_at);
      `);

      const insert = db.prepare(`
        INSERT INTO claude_runs (operation_id, operation_type, workspace, phase_label, child_label, model,
          cost_usd, duration_ms, num_turns, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const events = db.query(`
        SELECT e.operation_id, o.type, o.workspace, e.phase_label, e.child_label, e.data, e.timestamp
        FROM operation_events e JOIN operations o ON o.id = e.operation_id
        WHERE e.type = 'output' AND e.data LIKE '%"total_cost_usd"%'
        ORDER BY e.id
      `);
      for (const row of events.iterate() as Iterable<{
        operation_id: string; type: string; workspace: string; phase_label: string | null;
        child_label: string | null; data: string; timestamp: string;
      }>) {
        const u = parseRunUsage(row.data);
        if (!u) continue;
        insert.run(row.operation_id, row.type, row.workspace, row.phase_label, row.child_label, u.model,
          u.costUsd, u.durationMs, u.numTurns, u.inputTokens, u.cacheCreationTokens, u.cacheReadTokens, u.outputTokens, row.timestamp);
      }
    },
  },
  {
    version: 15,
    up: (db) => {
      db.exec(`
        CREATE TABLE chat_cost_pending (
          cli_session_id TEXT PRIMARY KEY,
          workspace      TEXT NOT NULL,
          agent_name     TEXT NOT NULL,
          baseline_json  TEXT
        );
      `);
    },
  },
  {
    version: 16,
    up: (db) => {
      // No foreign key to operations, like claude_runs: a bench outlives log pruning.
      db.exec(`
        CREATE TABLE bench_runs (
          operation_id  TEXT PRIMARY KEY,
          workspace     TEXT NOT NULL,
          step          TEXT NOT NULL,
          repo          TEXT,
          reference     TEXT NOT NULL,
          attempts_json TEXT NOT NULL,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
    },
  },
  {
    version: 17,
    up: (db) => {
      db.exec("DROP TABLE IF EXISTS bench_runs");
    },
  },
  {
    version: 18,
    up: (db) => {
      // No foreign keys to workspaces: events and lessons outlive the workspace
      // they came from, and lessons are keyed by clone, not by workspace.
      db.exec(`
        CREATE TABLE IF NOT EXISTS pr_watch (
          workspace     TEXT NOT NULL,
          repo_name     TEXT NOT NULL,
          pr_url        TEXT NOT NULL,
          state         TEXT NOT NULL,
          head_sha      TEXT NOT NULL,
          ci            TEXT NOT NULL,
          mergeable     TEXT NOT NULL,
          seen_comments TEXT NOT NULL,
          checked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          PRIMARY KEY (workspace, repo_name)
        );

        CREATE TABLE IF NOT EXISTS pr_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace   TEXT NOT NULL,
          repo_name   TEXT NOT NULL,
          pr_url      TEXT NOT NULL,
          kind        TEXT NOT NULL,
          author      TEXT,
          body        TEXT NOT NULL,
          url         TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pr_events_ws ON pr_events(workspace, occurred_at);

        CREATE TABLE IF NOT EXISTS repo_lessons (
          id               TEXT PRIMARY KEY,
          repo_key         TEXT NOT NULL,
          section          TEXT NOT NULL,
          text             TEXT NOT NULL,
          status           TEXT NOT NULL,
          evidence_json    TEXT NOT NULL,
          replaces_json    TEXT NOT NULL DEFAULT '[]',
          source_workspace TEXT NOT NULL,
          created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_repo_lessons_repo ON repo_lessons(repo_key, status);

        CREATE TABLE IF NOT EXISTS lesson_findings (
          repo_key  TEXT NOT NULL,
          workspace TEXT NOT NULL,
          summary   TEXT NOT NULL,
          kind      TEXT NOT NULL,
          PRIMARY KEY (repo_key, workspace, summary)
        );
      `);
    },
  },
  {
    version: 19,
    up: (db) => {
      // When a workspace's PR suggestions were last taken or dismissed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS pr_handled (
          workspace  TEXT PRIMARY KEY,
          handled_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 20,
    up: (db) => {
      const columns = db.query("SELECT name FROM pragma_table_info('repo_lessons')").all() as { name: string }[];
      if (columns.some((c) => c.name === "challenges_json")) return;
      db.exec("ALTER TABLE repo_lessons ADD COLUMN challenges_json TEXT NOT NULL DEFAULT '[]'");
    },
  },
];

/**
 * Run all pending migrations in order.
 * Each migration runs inside a transaction.
 */
const LATEST_VERSION = migrations[migrations.length - 1].version;

export function runMigrations(db: Database): void {
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

  // Fast path: already up-to-date (avoids re-checking on every getDb() call)
  if (currentVersion >= LATEST_VERSION) return;

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
