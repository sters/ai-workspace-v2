// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetQuickCreates,
  beginQuickCreate,
  finishQuickCreate,
  listQuickCreates,
  reportQuickCreate,
} from "@/lib/workspace/quick-create-progress";

beforeEach(() => {
  _resetQuickCreates();
});

describe("quick create progress", () => {
  it("lists a running create with what it has reported, newest first", () => {
    const first = beginQuickCreate("login crash", 1_000);
    const second = beginQuickCreate("widget", 2_000);
    reportQuickCreate(first, "[github.com/acme/web] fetching latest...");

    const listed = listQuickCreates(3_000);
    expect(listed.map((q) => q.id)).toEqual([second, first]);
    expect(listed[1]).toMatchObject({
      name: "login crash",
      state: "running",
      log: ["[github.com/acme/web] fetching latest..."],
    });
  });

  it("keeps a finished create for a while, so a form opened after it ended can still report it", () => {
    const id = beginQuickCreate("login crash", 0);
    finishQuickCreate(id, { workspace: "bugfix-login-crash", start: { kind: "chat", sessionId: "c" }, problems: 0 }, 1_000);

    expect(listQuickCreates(1_000 + 60_000)[0]).toMatchObject({
      state: "done",
      workspace: "bugfix-login-crash",
      start: { kind: "chat", sessionId: "c" },
    });
    expect(listQuickCreates(1_000 + 60 * 60_000)).toEqual([]);
  });

  it("never drops a running create, however long it takes", () => {
    beginQuickCreate("slow clone", 0);
    expect(listQuickCreates(24 * 60 * 60_000)).toHaveLength(1);
  });

  it("records a create that threw as failed", () => {
    const id = beginQuickCreate("n", 0);
    finishQuickCreate(id, { error: "Error: git exploded" }, 1);
    expect(listQuickCreates(2)[0]).toMatchObject({ state: "failed", error: "Error: git exploded" });
  });
});
