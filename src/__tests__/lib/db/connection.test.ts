// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";

describe("db/connection", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
  });

  it("returns the same database instance on repeated calls", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("creates a new instance after _resetDb()", () => {
    const db1 = getDb();
    _resetDb();
    const db2 = getDb();
    expect(db1).not.toBe(db2);
  });

  it("creates schema_migrations table", () => {
    const db = getDb();
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get();
    expect(row).not.toBeNull();
  });

  it("creates operations table with correct columns", () => {
    const db = getDb();
    const cols = db.query("PRAGMA table_info(operations)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("type");
    expect(names).toContain("workspace");
    expect(names).toContain("status");
    expect(names).toContain("started_at");
    expect(names).toContain("completed_at");
    expect(names).toContain("children_json");
    expect(names).toContain("phases_json");
    expect(names).toContain("inputs_json");
    expect(names).toContain("result_summary");
  });

  it("creates operation_events table", () => {
    const db = getDb();
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='operation_events'")
      .get();
    expect(row).not.toBeNull();
  });

  it("creates push_subscriptions table", () => {
    const db = getDb();
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'")
      .get();
    expect(row).not.toBeNull();
  });

  it("creates chat_sessions table", () => {
    const db = getDb();
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_sessions'")
      .get();
    expect(row).not.toBeNull();
  });

  it("creates workspace_suggestions table", () => {
    const db = getDb();
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_suggestions'")
      .get();
    expect(row).not.toBeNull();
  });

  it("records migration version", () => {
    const db = getDb();
    const row = db
      .query("SELECT MAX(version) as v FROM schema_migrations")
      .get() as { v: number };
    expect(row.v).toBe(2);
  });
});
