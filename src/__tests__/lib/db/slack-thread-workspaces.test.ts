// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { getSession, setSession } from "@/lib/db/slack-sessions";
import {
  bindThreadWorkspace,
  endThreadTurn,
  findWorkspaceThread,
  getThreadTurnStartedAt,
  getThreadWorkspace,
  startThreadTurn,
} from "@/lib/db/slack-thread-workspaces";

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

  it("finds the thread a workspace is bound to with its link, and none for an unbound workspace", () => {
    bindThreadWorkspace("t1", "ws-a", "https://example.slack.com/archives/C1/p1");
    bindThreadWorkspace("t2", "ws-b", "https://example.slack.com/archives/C1/p2");
    expect(findWorkspaceThread("ws-b")).toEqual({
      threadKey: "t2",
      permalink: "https://example.slack.com/archives/C1/p2",
    });
    expect(findWorkspaceThread("ws-c")).toBeUndefined();
  });

  it("finds a thread bound without a link, reporting no link", () => {
    bindThreadWorkspace("t1", "ws-a");
    expect(findWorkspaceThread("ws-a")).toEqual({ threadKey: "t1" });
  });

  it("a thread moved to another workspace no longer belongs to the old one", () => {
    bindThreadWorkspace("t", "ws-a");
    bindThreadWorkspace("t", "ws-b");
    expect(findWorkspaceThread("ws-a")).toBeUndefined();
  });

  it("records a turn in flight until it ends", () => {
    bindThreadWorkspace("t", "ws-a");
    expect(getThreadTurnStartedAt("t")).toBeUndefined();
    startThreadTurn("t", 1234);
    expect(getThreadTurnStartedAt("t")).toBe(1234);
    endThreadTurn("t");
    expect(getThreadTurnStartedAt("t")).toBeUndefined();
  });

  it("a rebind clears a turn left in flight", () => {
    bindThreadWorkspace("t", "ws-a");
    startThreadTurn("t", 1234);
    bindThreadWorkspace("t", "ws-b");
    expect(getThreadTurnStartedAt("t")).toBeUndefined();
  });
});
