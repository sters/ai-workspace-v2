import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";
import { runMigrations } from "./migrations";
import { getWorkspaceDbPath } from "@/lib/config/workspace-dir";
import { getResolvedWorkspaceRoot } from "@/lib/config/resolver";

const globalStore = globalThis as unknown as {
  __aiwDb?: Database | null;
  __aiwDbPath?: string;
  __aiwDbResetCallbacks?: Set<() => void>;
};

/**
 * Get the SQLite database singleton.
 * Creates the database and runs migrations on first call.
 * Stored on globalThis to survive Next.js module isolation / HMR.
 */
export function getDb(): Database {
  if (globalStore.__aiwDb) {
    return globalStore.__aiwDb;
  }

  const dbPath = globalStore.__aiwDbPath ?? getWorkspaceDbPath(getResolvedWorkspaceRoot());

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
    import("./migrate-jsonl")
      .then(({ migrateJsonlToSqlite }) => migrateJsonlToSqlite())
      .catch((err: unknown) => {
        // migrate-jsonl may not be available in all environments
        if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")) {
          console.warn("[db] JSONL migration failed:", err);
        }
      });
  }

  return db;
}

/**
 * Callbacks registered by other db modules to reset their prepared statements.
 * Called by `_resetDb()` to prevent stale statement references.
 * Stored on globalThis to prevent duplicate registrations across HMR reloads.
 */
if (!globalStore.__aiwDbResetCallbacks) {
  globalStore.__aiwDbResetCallbacks = new Set();
}
const resetCallbacks = globalStore.__aiwDbResetCallbacks;

/** Register a callback that will be invoked when the DB is reset. */
export function _onDbReset(cb: () => void): void {
  resetCallbacks.add(cb);
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
