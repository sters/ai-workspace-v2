// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  archiveWorkspace,
  unarchiveWorkspace,
  isWorkspaceArchived,
  listArchivedWorkspaces,
  getArchivedNameSet,
} from "@/lib/db/archives";

describe("db/archives", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("archives a workspace", () => {
    archiveWorkspace("ws-1");
    expect(isWorkspaceArchived("ws-1")).toBe(true);
  });

  it("returns false for non-archived workspace", () => {
    expect(isWorkspaceArchived("ws-1")).toBe(false);
  });

  it("unarchives a workspace", () => {
    archiveWorkspace("ws-1");
    unarchiveWorkspace("ws-1");
    expect(isWorkspaceArchived("ws-1")).toBe(false);
  });

  it("archiving twice is idempotent (INSERT OR IGNORE)", () => {
    archiveWorkspace("ws-1");
    archiveWorkspace("ws-1");
    expect(isWorkspaceArchived("ws-1")).toBe(true);
    expect(listArchivedWorkspaces()).toHaveLength(1);
  });

  it("lists archived workspaces", () => {
    archiveWorkspace("ws-1");
    archiveWorkspace("ws-2");

    const list = listArchivedWorkspaces();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBeTruthy();
    expect(list[0].archivedAt).toBeTruthy();
  });

  it("returns archived name set for efficient lookup", () => {
    archiveWorkspace("ws-1");
    archiveWorkspace("ws-3");

    const set = getArchivedNameSet();
    expect(set.has("ws-1")).toBe(true);
    expect(set.has("ws-2")).toBe(false);
    expect(set.has("ws-3")).toBe(true);
  });

  it("unarchiving non-existent workspace is a no-op", () => {
    unarchiveWorkspace("nonexistent");
    expect(listArchivedWorkspaces()).toHaveLength(0);
  });
});
