// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  writeOperationLog,
  readOperationLog,
  listStoredOperations,
  deleteStoredOperation,
  deleteStoredOperationsForWorkspace,
} from "@/lib/operation-store";
import type { Operation, OperationEvent } from "@/types/operation";
import { getDb, _resetDb, _setDbPath, insertOperation, appendEvents } from "@/lib/db";

// Deterministic UUIDs for test use
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";

function makeOperation(id: string, overrides?: Partial<Operation>): Operation {
  return {
    id,
    type: "execute",
    workspace: "test-workspace",
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvent(operationId: string, type: OperationEvent["type"] = "status"): OperationEvent {
  return {
    type,
    operationId,
    data: "test data",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Helper: insert an operation + events directly into SQLite,
 * simulating the full pipeline flow (insertOperation → appendEvents → writeOperationLog).
 */
function writeViaDb(op: Operation, events: OperationEvent[]) {
  insertOperation(op);
  if (events.length > 0) {
    appendEvents(events);
  }
  // writeOperationLog updates status/meta (simulating markComplete)
  writeOperationLog(op, events);
}

describe("operation-store", () => {
  beforeEach(() => {
    // Reset DB for each test to ensure isolation
    _resetDb();
    _setDbPath(":memory:");
    getDb(); // re-initialize
  });

  describe("writeOperationLog + readOperationLog roundtrip", () => {
    it("writes and reads back an operation with events", () => {
      const op = makeOperation(ID1);
      const events = [
        makeEvent(ID1, "status"),
        makeEvent(ID1, "output"),
        makeEvent(ID1, "complete"),
      ];

      writeViaDb(op, events);
      const result = readOperationLog(ID1);

      expect(result).not.toBeNull();
      expect(result!.operation).toEqual(op);
      expect(result!.events).toHaveLength(3);
      expect(result!.events[0].type).toBe("status");
      expect(result!.events[1].type).toBe("output");
      expect(result!.events[2].type).toBe("complete");
    });

    it("preserves event fields through roundtrip", () => {
      const op = makeOperation(ID2);
      const events: OperationEvent[] = [
        {
          type: "status",
          operationId: ID2,
          data: "Phase 1/2: Setup",
          timestamp: "2024-01-01T00:00:00.000Z",
          childLabel: "setup",
          phaseIndex: 0,
          phaseLabel: "Setup",
        },
      ];

      writeViaDb(op, events);
      const result = readOperationLog(ID2);

      expect(result!.events[0]).toEqual(events[0]);
    });

    it("reads with explicit workspace without scanning all dirs", () => {
      const op = makeOperation(ID1, { workspace: "ws-a" });
      writeViaDb(op, [makeEvent(ID1)]);

      // Read with correct workspace
      expect(readOperationLog(ID1, "ws-a")).not.toBeNull();
      // Read with wrong workspace
      expect(readOperationLog(ID1, "ws-b")).toBeNull();
      // Read without workspace
      expect(readOperationLog(ID1)).not.toBeNull();
    });
  });

  describe("readOperationLog", () => {
    it("returns null for nonexistent operation", () => {
      expect(readOperationLog("00000000-0000-4000-8000-000000999999")).toBeNull();
    });

    it("returns null for invalid operation ID", () => {
      expect(readOperationLog("../../../etc/passwd")).toBeNull();
      expect(readOperationLog("invalid-id")).toBeNull();
    });
  });

  describe("listStoredOperations", () => {
    it("returns operations sorted by startedAt descending", () => {
      const op1 = makeOperation(ID1, {
        startedAt: "2024-01-01T00:00:00.000Z",
      });
      const op2 = makeOperation(ID2, {
        startedAt: "2024-01-03T00:00:00.000Z",
      });
      const op3 = makeOperation(ID3, {
        startedAt: "2024-01-02T00:00:00.000Z",
      });

      writeViaDb(op1, []);
      writeViaDb(op2, []);
      writeViaDb(op3, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(3);
      expect(ops[0].id).toBe(ID2); // newest
      expect(ops[1].id).toBe(ID3);
      expect(ops[2].id).toBe(ID1); // oldest
    });

    it("filters by workspace when provided", () => {
      writeViaDb(makeOperation(ID1, { workspace: "ws-a" }), []);
      writeViaDb(makeOperation(ID2, { workspace: "ws-b" }), []);
      writeViaDb(makeOperation(ID3, { workspace: "ws-a" }), []);

      const opsA = listStoredOperations("ws-a");
      expect(opsA).toHaveLength(2);
      expect(opsA.every((op) => op.workspace === "ws-a")).toBe(true);

      const opsB = listStoredOperations("ws-b");
      expect(opsB).toHaveLength(1);
      expect(opsB[0].workspace).toBe("ws-b");

      // All workspaces
      expect(listStoredOperations()).toHaveLength(3);
    });

    it("returns empty array when no operations exist", () => {
      expect(listStoredOperations()).toEqual([]);
    });

    it("includes inputs in summaries when present", () => {
      const op = makeOperation(ID1, {
        inputs: { instruction: "Do something", description: "Details here" },
      });
      writeViaDb(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toEqual({ instruction: "Do something", description: "Details here" });
    });

    it("omits inputs when operation has no inputs", () => {
      const op = makeOperation(ID1);
      writeViaDb(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toBeUndefined();
    });
  });

  describe("deleteStoredOperation", () => {
    it("deletes an existing operation", () => {
      const op = makeOperation(ID1);
      writeViaDb(op, [makeEvent(ID1)]);

      expect(deleteStoredOperation(ID1)).toBe(true);
      expect(readOperationLog(ID1)).toBeNull();
    });

    it("deletes with explicit workspace", () => {
      const op = makeOperation(ID1, { workspace: "ws-x" });
      writeViaDb(op, []);

      expect(deleteStoredOperation(ID1, "ws-x")).toBe(true);
      expect(readOperationLog(ID1, "ws-x")).toBeNull();
    });

    it("returns false for nonexistent operation", () => {
      expect(deleteStoredOperation("00000000-0000-4000-8000-000000999999")).toBe(false);
    });

    it("returns false for invalid ID", () => {
      expect(deleteStoredOperation("../../../etc/passwd")).toBe(false);
    });

    it("cascade deletes events", () => {
      const op = makeOperation(ID1);
      writeViaDb(op, [makeEvent(ID1), makeEvent(ID1)]);

      deleteStoredOperation(ID1);
      const result = readOperationLog(ID1);
      expect(result).toBeNull();
    });
  });

  describe("deleteStoredOperationsForWorkspace", () => {
    it("deletes all operations for a workspace", () => {
      writeViaDb(makeOperation(ID1, { workspace: "ws-del" }), []);
      writeViaDb(makeOperation(ID2, { workspace: "ws-del" }), []);
      writeViaDb(makeOperation(ID3, { workspace: "ws-keep" }), []);

      const deleted = deleteStoredOperationsForWorkspace("ws-del");
      expect(deleted).toBe(true);

      expect(listStoredOperations("ws-del")).toHaveLength(0);
      expect(listStoredOperations("ws-keep")).toHaveLength(1);
    });

    it("returns false when workspace has no operations", () => {
      expect(deleteStoredOperationsForWorkspace("nonexistent")).toBe(false);
    });

    it("returns false for invalid workspace name", () => {
      expect(deleteStoredOperationsForWorkspace("../../../etc")).toBe(false);
    });
  });

  describe("ID validation", () => {
    it("rejects path traversal in operation ID", () => {
      const op = makeOperation("../../../etc/passwd" as string);
      // writeViaDb validates, so use writeOperationLog directly
      writeOperationLog(op, []);
      expect(readOperationLog("../../../etc/passwd" as string)).toBeNull();
    });

    it("rejects IDs that don't match the pattern", () => {
      expect(readOperationLog("not-a-valid-id")).toBeNull();
      expect(readOperationLog("pipe-abc-def")).toBeNull();
      expect(readOperationLog("pipe-1")).toBeNull();
      expect(deleteStoredOperation("hack/../../../etc")).toBe(false);
    });

    it("accepts valid UUID IDs", () => {
      const id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const op = makeOperation(id);
      writeViaDb(op, []);
      expect(readOperationLog(id)).not.toBeNull();
    });
  });
});
