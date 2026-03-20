import { Database } from "bun:sqlite";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { runMigrations } from "./migrations";

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  ".config",
  "ai-workspace",
  "db.sqlite",
);

const globalStore = globalThis as unknown as {
  __aiwDb?: Database | null;
  __aiwDbPath?: string;
};

/**
 * Get the SQLite database singleton.
 * Creates the database and runs migrations on first call.
 * Stored on globalThis to survive Next.js module isolation / HMR.
 */
export function getDb(): Database {
  if (globalStore.__aiwDb) {
    // Run pending migrations even on cached instances (handles HMR adding new migrations)
    runMigrations(globalStore.__aiwDb);
    return globalStore.__aiwDb;
  }

  const dbPath = globalStore.__aiwDbPath ?? DEFAULT_DB_PATH;

  // Ensure the directory exists for file-based databases
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read/write performance
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);

  globalStore.__aiwDb = db;

  // Auto-migrate legacy JSONL files on first startup (lazy import to avoid circular deps)
  if (dbPath !== ":memory:") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { migrateJsonlToSqlite } = require("./migrate-jsonl") as typeof import("./migrate-jsonl");
      migrateJsonlToSqlite();
    } catch {
      // migrate-jsonl may not be available in all environments
    }
  }

  return db;
}

/**
 * Callbacks registered by other db modules to reset their prepared statements.
 * Called by `_resetDb()` to prevent stale statement references.
 */
const resetCallbacks: Array<() => void> = [];

/** Register a callback that will be invoked when the DB is reset. */
export function _onDbReset(cb: () => void): void {
  resetCallbacks.push(cb);
}

/** Close and reset the database singleton. For testing only. */
export function _resetDb(): void {
  // Reset all prepared statements first (while DB is still open, in case they need it)
  for (const cb of resetCallbacks) {
    cb();
  }
  if (globalStore.__aiwDb) {
    globalStore.__aiwDb.close();
    globalStore.__aiwDb = null;
  }
}

/** Override the database file path. For testing only. Call before first getDb(). */
export function _setDbPath(p: string): void {
  globalStore.__aiwDbPath = p;
}
