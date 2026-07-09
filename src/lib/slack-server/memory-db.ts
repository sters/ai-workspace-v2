import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getWorkspaceConfigDir } from "@/lib/config/workspace-dir";

/**
 * The Slack conversation's long-term memory lives in a SQLite file that is
 * SEPARATE from the operational `db.sqlite`. The conversation Claude reads and
 * writes it directly via the `sqlite3` CLI (see the slack-chat prompt), so
 * keeping it isolated means a stray query from the model can never corrupt or
 * lock the operational data (operations, events, notifications, …).
 *
 * Memory is scoped strictly by Slack `user_id`; there is no shared/global
 * memory. TS only owns the schema: it ensures the file and table exist so the
 * model's SELECTs always succeed (empty result, not a "no such table" error).
 */

/** Filename of the dedicated Slack memory database under `.ai-workspace/`. */
export const SLACK_MEMORY_DB_FILENAME = "slack-memory.sqlite";

/** Absolute path to the Slack memory database for a given workspace root. */
export function getSlackMemoryDbPath(workspaceRoot: string): string {
  return path.join(getWorkspaceConfigDir(workspaceRoot), SLACK_MEMORY_DB_FILENAME);
}

/**
 * Create the Slack memory database file and its `memories` table if absent, and
 * return the absolute path. The connection is opened only to run the DDL and is
 * closed before returning — the model owns the file at runtime via `sqlite3`.
 * Idempotent (uses `IF NOT EXISTS`).
 */
export function ensureSlackMemoryDb(workspaceRoot: string): string {
  const dbPath = getSlackMemoryDbPath(workspaceRoot);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    `);
  } finally {
    db.close();
  }
  return dbPath;
}
