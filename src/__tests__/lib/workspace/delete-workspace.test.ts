// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { _resetConfig, _resetWorkspaceRoot, setWorkspaceRoot } from "@/lib/config";
import { deleteWorkspace } from "@/lib/workspace/git";
import {
  _resetQuickCreates,
  beginQuickCreate,
  finishQuickCreate,
  reportQuickCreateWorkspace,
} from "@/lib/workspace/quick-create-progress";

let root: string;
let wsPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join("/tmp", "aiw-delete-"));
  wsPath = path.join(root, "workspace", "feature-widget-20260101");
  fs.mkdirSync(wsPath, { recursive: true });
  fs.writeFileSync(path.join(wsPath, "README.md"), "# Task: widget\n");
  setWorkspaceRoot(root);
  _resetConfig();
  _resetQuickCreates();
});

afterEach(() => {
  _resetConfig();
  _resetWorkspaceRoot();
  fs.rmSync(root, { recursive: true, force: true });
});

// A quick create that is still setting up repositories recreates the directory
// for its next worktree, leaving worktrees and branches under a workspace with
// no README — one the dashboard does not list and nothing can delete.
describe("deleteWorkspace while a quick create is building it", () => {
  it("refuses, and leaves the workspace in place", async () => {
    const id = beginQuickCreate("widget");
    reportQuickCreateWorkspace(id, "feature-widget-20260101");

    await expect(deleteWorkspace("feature-widget-20260101")).rejects.toThrow(/still being set up/);
    expect(fs.existsSync(path.join(wsPath, "README.md"))).toBe(true);
  });

  it("deletes once that create has finished", async () => {
    const id = beginQuickCreate("widget");
    reportQuickCreateWorkspace(id, "feature-widget-20260101");
    finishQuickCreate(id, { workspace: "feature-widget-20260101", start: { kind: "none" }, problems: 0 });

    await deleteWorkspace("feature-widget-20260101");
    expect(fs.existsSync(wsPath)).toBe(false);
  });
});
