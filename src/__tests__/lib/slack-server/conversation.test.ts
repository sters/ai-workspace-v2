import { describe, expect, it } from "vitest";
import { ConversationSessions } from "@/lib/slack-server/conversation";

describe("ConversationSessions", () => {
  it("stores and retrieves a session id for a thread", () => {
    const s = new ConversationSessions();
    s.set("thread-1", "sess-abc", 1000);
    expect(s.get("thread-1", 1000)).toBe("sess-abc");
    expect(s.get("thread-2", 1000)).toBeUndefined();
  });

  it("overwrites the session id when a thread is updated", () => {
    const s = new ConversationSessions();
    s.set("t", "sess-1", 1000);
    s.set("t", "sess-2", 2000);
    expect(s.get("t", 2000)).toBe("sess-2");
    expect(s.size).toBe(1);
  });

  it("expires sessions older than the TTL", () => {
    const ttl = 1000;
    const s = new ConversationSessions(ttl, 100);
    s.set("t", "sess", 0);
    expect(s.get("t", ttl)).toBe("sess"); // exactly at TTL is still live
    expect(s.get("t", ttl + 1)).toBeUndefined(); // past TTL is gone
    expect(s.size).toBe(0);
  });

  it("refreshing a session resets its expiry", () => {
    const ttl = 1000;
    const s = new ConversationSessions(ttl, 100);
    s.set("t", "sess", 0);
    s.set("t", "sess", 900); // refresh keeps it alive
    expect(s.get("t", 1800)).toBe("sess");
  });

  it("evicts the oldest thread when over the size cap", () => {
    const s = new ConversationSessions(1_000_000, 2);
    s.set("a", "sa", 100);
    s.set("b", "sb", 200);
    s.set("c", "sc", 300); // over cap → oldest ("a") evicted
    expect(s.size).toBe(2);
    expect(s.get("a", 300)).toBeUndefined();
    expect(s.get("b", 300)).toBe("sb");
    expect(s.get("c", 300)).toBe("sc");
  });

  it("clear() drops all sessions", () => {
    const s = new ConversationSessions();
    s.set("a", "sa", 0);
    s.set("b", "sb", 0);
    s.clear();
    expect(s.size).toBe(0);
  });
});
