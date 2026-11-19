// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OperationListItem } from "@/types/operation";

let workspaceDir = "";
vi.mock("@/lib/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config")>()),
  getWorkspaceDir: () => workspaceDir,
}));

const running: OperationListItem[] = [];
vi.mock("@/lib/pipeline-manager", () => ({
  getOperationSummaries: () => running,
}));

import { getDb, _resetDb, _setDbPath, insertOperation } from "@/lib/db";
import { resolveOperationPage } from "@/lib/operation-page";

async function makeWorkspace(name: string) {
  await mkdir(path.join(workspaceDir, name), { recursive: true });
  await writeFile(path.join(workspaceDir, name, "README.md"), "# ws\n");
}

describe("resolveOperationPage", () => {
  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), "aiw-op-page-"));
    running.length = 0;
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it("sends an operation of an existing workspace to that workspace's Operations tab", async () => {
    await makeWorkspace("my-app");
    insertOperation({ id: "op-1", type: "execute", workspace: "my-app", status: "completed", startedAt: "2026-01-01T00:00:00Z" });

    expect(await resolveOperationPage("op-1")).toEqual({
      kind: "workspace",
      href: "/workspace/my-app/operations?operationId=op-1",
    });
  });

  it("shows an operation filed under a label that is no workspace on its own page", async () => {
    insertOperation({ id: "op-2", type: "scheduled-task", workspace: "scheduled-task-3", status: "failed", startedAt: "2026-01-01T00:00:00Z" });

    const page = await resolveOperationPage("op-2");
    expect(page).toMatchObject({ kind: "standalone", operation: { id: "op-2", status: "failed" } });
  });

  it("shows an operation whose workspace has since been deleted on its own page", async () => {
    await mkdir(path.join(workspaceDir, "gone"), { recursive: true }); // no README: not a workspace
    insertOperation({ id: "op-3", type: "execute", workspace: "gone", status: "completed", startedAt: "2026-01-01T00:00:00Z" });

    expect(await resolveOperationPage("op-3")).toMatchObject({ kind: "standalone" });
  });

  it("does not treat a label that walks out of the workspace directory as a workspace", async () => {
    await writeFile(path.join(workspaceDir, "README.md"), "# root\n");
    insertOperation({ id: "op-4", type: "init", workspace: "", status: "running", startedAt: "2026-01-01T00:00:00Z" });
    insertOperation({ id: "op-5", type: "execute", workspace: ".", status: "completed", startedAt: "2026-01-01T00:00:00Z" });

    expect(await resolveOperationPage("op-4")).toMatchObject({ kind: "standalone" });
    expect(await resolveOperationPage("op-5")).toMatchObject({ kind: "standalone" });
  });

  it("prefers the in-memory state of a running operation over its row", async () => {
    insertOperation({ id: "op-6", type: "workspace-prune", workspace: "prune-7d", status: "running", startedAt: "2026-01-01T00:00:00Z" });
    running.push({ id: "op-6", type: "workspace-prune", workspace: "prune-7d", status: "running", startedAt: "2026-01-01T00:00:00Z", hasPendingAsk: true });

    expect(await resolveOperationPage("op-6")).toMatchObject({ kind: "standalone", operation: { hasPendingAsk: true } });
  });

  it("returns null for an unknown id", async () => {
    expect(await resolveOperationPage("nope")).toBeNull();
  });
});
