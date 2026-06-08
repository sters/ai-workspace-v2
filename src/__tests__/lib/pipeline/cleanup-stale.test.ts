// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  getDb,
  _resetDb,
  _setDbPath,
  insertOperation,
  updateOperationMeta,
  updateOperationWorkspace,
  listRunningOperations,
  getOperation as dbGetOperation,
} from "@/lib/db";
import type { Operation, OperationPhaseInfo } from "@/types/operation";

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const OP_ID_1 = "00000000-0000-4000-8000-000000000001";
const OP_ID_2 = "00000000-0000-4000-8000-000000000002";
const OP_ID_3 = "00000000-0000-4000-8000-000000000003";

function makeOp(id: string, overrides?: Partial<Operation>): Operation {
  return {
    id,
    type: "execute",
    workspace: "test-ws",
    status: "running",
    startedAt: new Date().toISOString(),
    children: [],
    phases: [
      { index: 0, label: "Phase A", status: "completed" },
      { index: 1, label: "Phase B", status: "running" },
      { index: 2, label: "Phase C", status: "pending" },
    ],
    ...overrides,
  };
}

describe("pipeline/cleanup-stale", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  describe("listRunningOperations", () => {
    it("returns only operations with status=running", () => {
      insertOperation(makeOp(OP_ID_1, { status: "running" }));
      insertOperation(makeOp(OP_ID_2, { status: "completed" }));
      insertOperation(makeOp(OP_ID_3, { status: "running" }));

      const running = listRunningOperations();
      expect(running).toHaveLength(2);
      expect(running.map((o) => o.id).sort()).toEqual([OP_ID_1, OP_ID_3].sort());
    });

    it("returns empty array when no running operations", () => {
      insertOperation(makeOp(OP_ID_1, { status: "completed" }));
      expect(listRunningOperations()).toHaveLength(0);
    });
  });

  describe("failStaleOperations", () => {
    it("marks interrupted running operations as failed instead of resuming them", async () => {
      // Partially-completed pipeline (Phase B was running) — must not be resumed.
      insertOperation(makeOp(OP_ID_1, { type: "execute", status: "running" }));
      insertOperation(makeOp(OP_ID_2, { type: "autonomous", status: "running" }));

      const { failStaleOperations } = await import("@/lib/pipeline/cleanup-stale");
      failStaleOperations();

      // Nothing left running — neither resumed nor stuck.
      expect(listRunningOperations()).toHaveLength(0);
      expect(dbGetOperation(OP_ID_1)?.status).toBe("failed");
      expect(dbGetOperation(OP_ID_2)?.status).toBe("failed");
    });

    it("marks operations with all phases completed as completed", async () => {
      const phases: OperationPhaseInfo[] = [
        { index: 0, label: "Phase A", status: "completed" },
        { index: 1, label: "Phase B", status: "completed" },
      ];
      insertOperation(makeOp(OP_ID_1, { status: "running", phases }));
      updateOperationMeta(OP_ID_1, { phases });

      const { failStaleOperations } = await import("@/lib/pipeline/cleanup-stale");
      failStaleOperations();

      const op = dbGetOperation(OP_ID_1);
      expect(op?.status).toBe("completed");
    });

    it("does nothing when no running operations exist", async () => {
      insertOperation(makeOp(OP_ID_1, { status: "completed" }));

      const { failStaleOperations } = await import("@/lib/pipeline/cleanup-stale");
      failStaleOperations(); // Should not throw
    });
  });

  describe("updateOperationWorkspace", () => {
    it("persists workspace changes to SQLite", () => {
      insertOperation(makeOp(OP_ID_1, { workspace: "" }));
      updateOperationWorkspace(OP_ID_1, "new-workspace");

      const op = dbGetOperation(OP_ID_1);
      expect(op?.workspace).toBe("new-workspace");
    });
  });
});
