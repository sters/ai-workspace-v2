// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureSlackMemoryDb,
  getSlackMemoryDbPath,
  SLACK_MEMORY_DB_FILENAME,
} from "@/lib/slack-server/memory-db";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-slack-mem-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("slack-server/memory-db", () => {
  it("resolves the path under .ai-workspace", () => {
    expect(getSlackMemoryDbPath(root)).toBe(
      path.join(root, ".ai-workspace", SLACK_MEMORY_DB_FILENAME),
    );
  });

  it("creates the file and memories table with a user_id column", () => {
    const dbPath = ensureSlackMemoryDb(root);
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath);
    try {
      const cols = (db.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      expect(cols).toEqual(
        expect.arrayContaining(["id", "user_id", "content", "created_at", "updated_at"]),
      );
      // Table is usable for scoped read/write.
      db.run("INSERT INTO memories (user_id, content) VALUES ('U1', 'likes X')");
      const rows = db
        .query("SELECT content FROM memories WHERE user_id = 'U1'")
        .all() as Array<{ content: string }>;
      expect(rows).toEqual([{ content: "likes X" }]);
    } finally {
      db.close();
    }
  });

  it("is idempotent and preserves existing rows", () => {
    const dbPath = ensureSlackMemoryDb(root);
    let db = new Database(dbPath);
    db.run("INSERT INTO memories (user_id, content) VALUES ('U1', 'fact')");
    db.close();

    // Second call must not throw or wipe data.
    expect(ensureSlackMemoryDb(root)).toBe(dbPath);

    db = new Database(dbPath);
    const n = (db.query("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n;
    db.close();
    expect(n).toBe(1);
  });
});
