// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { getSession, setSession } from "@/lib/db/slack-sessions";
import { bindThreadWorkspace, getThreadWorkspace } from "@/lib/db/slack-thread-workspaces";

describe("db/slack-thread-workspaces", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("returns the workspace a thread was bound to, and nothing for another thread", () => {
    bindThreadWorkspace("1700000000.000100", "feature-login-20261020");
    expect(getThreadWorkspace("1700000000.000100")).toBe("feature-login-20261020");
    expect(getThreadWorkspace("1700000000.000200")).toBeUndefined();
  });

  it("rebinding a thread moves it to the new workspace", () => {
    bindThreadWorkspace("t", "ws-a");
    bindThreadWorkspace("t", "ws-b");
    expect(getThreadWorkspace("t")).toBe("ws-b");
  });

  it("outlives the thread's conversation session", () => {
    setSession("t", "sess", 0, 1000, 100);
    bindThreadWorkspace("t", "ws-a");
    expect(getSession("t", 5000, 1000)).toBeUndefined();
    expect(getThreadWorkspace("t")).toBe("ws-a");
  });
});
