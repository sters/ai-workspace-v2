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
});
