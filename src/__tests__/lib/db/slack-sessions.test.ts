// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  getSession,
  setSession,
  deleteSession,
  countSessions,
} from "@/lib/db/slack-sessions";

describe("db/slack-sessions", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("stores and retrieves a session id for a thread", () => {
    setSession("thread-1", "sess-abc", 1000);
    expect(getSession("thread-1", 1000)).toBe("sess-abc");
    expect(getSession("thread-2", 1000)).toBeUndefined();
  });

  it("overwrites the session id when a thread is updated", () => {
    setSession("t", "sess-1", 1000);
    setSession("t", "sess-2", 2000);
    expect(getSession("t", 2000)).toBe("sess-2");
    expect(countSessions()).toBe(1);
  });

  it("expires sessions older than the TTL", () => {
    const ttl = 1000;
    setSession("t", "sess", 0, ttl, 100);
    expect(getSession("t", ttl, ttl)).toBe("sess"); // exactly at TTL is still live
    expect(getSession("t", ttl + 1, ttl)).toBeUndefined(); // past TTL is gone
    expect(countSessions()).toBe(0);
  });

  it("refreshing a session resets its expiry", () => {
    const ttl = 1000;
    setSession("t", "sess", 0, ttl, 100);
    setSession("t", "sess", 900, ttl, 100); // refresh keeps it alive
    expect(getSession("t", 1800, ttl)).toBe("sess");
  });

  it("evicts the oldest thread when over the size cap", () => {
    const ttl = 1_000_000;
    setSession("a", "sa", 100, ttl, 2);
    setSession("b", "sb", 200, ttl, 2);
    setSession("c", "sc", 300, ttl, 2); // over cap → oldest ("a") evicted
    expect(countSessions()).toBe(2);
    expect(getSession("a", 300, ttl)).toBeUndefined();
    expect(getSession("b", 300, ttl)).toBe("sb");
    expect(getSession("c", 300, ttl)).toBe("sc");
  });

  it("deleteSession removes a thread and is idempotent", () => {
    setSession("t", "sess", 0);
    deleteSession("t");
    expect(getSession("t", 0)).toBeUndefined();
    deleteSession("t"); // no throw on absent row
  });

  it("persists across a DB singleton reset (same file)", () => {
    // Simulate a slack-server restart: a fresh getDb() over the same file must
    // still see the row. Uses a temp file rather than :memory: (which is
    // per-connection).
    const tmp = `/tmp/aiw-slack-sessions-${process.pid}-${Math.floor(performance.now())}.sqlite`;
    _resetDb();
    _setDbPath(tmp);
    getDb();
    setSession("t", "sess-persist", 1000);

    _resetDb(); // closes the connection
    _setDbPath(tmp);
    getDb(); // reopens the same file

    expect(getSession("t", 1000)).toBe("sess-persist");
  });
});
