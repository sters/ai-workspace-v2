// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDb, _resetDb, _setDbPath, insertOperation } from "@/lib/db";
import { _resetConfig, _resetWorkspaceRoot, setWorkspaceRoot } from "@/lib/config";
import { bindThreadWorkspace } from "@/lib/db/slack-thread-workspaces";
import { resolveBoundWorkspace } from "@/lib/slack-server/bound-workspace";
import type { Operation } from "@/types/operation";

function op(id: string, workspace: string, status: Operation["status"]): Operation {
  return { id, type: "autonomous", workspace, status, startedAt: new Date().toISOString(), children: [] } as unknown as Operation;
}

describe("resolveBoundWorkspace", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "aiw-bound-"));
    await mkdir(path.join(root, "workspace", "feature-login-20261020"), { recursive: true });
    _resetDb();
    _resetConfig();
    _resetWorkspaceRoot();
    setWorkspaceRoot(root);
    _setDbPath(":memory:");
    getDb();
  });

  afterEach(async () => {
    _resetConfig();
    _resetWorkspaceRoot();
    await rm(root, { recursive: true, force: true });
  });

  it("is undefined for a thread no workspace was bound to", async () => {
    expect(await resolveBoundWorkspace("t")).toBeUndefined();
  });

  it("resolves the bound workspace's directory", async () => {
    bindThreadWorkspace("t", "feature-login-20261020");
    expect(await resolveBoundWorkspace("t")).toEqual({
      name: "feature-login-20261020",
      path: path.join(root, "workspace", "feature-login-20261020"),
      runningOperation: undefined,
    });
  });

  it("is undefined once the workspace has been deleted", async () => {
    bindThreadWorkspace("t", "feature-gone-20261020");
    expect(await resolveBoundWorkspace("t")).toBeUndefined();
  });

  it("names an operation running on that workspace, and ignores ones elsewhere or finished", async () => {
    bindThreadWorkspace("t", "feature-login-20261020");
    insertOperation(op("a", "other-ws", "running"));
    insertOperation(op("b", "feature-login-20261020", "completed"));
    expect((await resolveBoundWorkspace("t"))?.runningOperation).toBeUndefined();

    insertOperation(op("c", "feature-login-20261020", "running"));
    expect((await resolveBoundWorkspace("t"))?.runningOperation).toBe("autonomous");
  });
});
