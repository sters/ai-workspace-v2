import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  writeOperationLog,
  readOperationLog,
  listStoredOperations,
  deleteStoredOperation,
  deleteStoredOperationsForWorkspace,
} from "@/lib/operation-store";
import type { Operation, OperationEvent } from "@/types/operation";
import { AI_WORKSPACE_ROOT } from "@/lib/config";

const OPERATIONS_DIR = path.join(AI_WORKSPACE_ROOT, ".operations");

// Deterministic UUIDs for test use
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";

function rmrf(dir: string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rmrf(full);
    } else {
      fs.unlinkSync(full);
    }
  }
  fs.rmdirSync(dir);
}

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

describe("operation-store", () => {
  beforeEach(() => {
    rmrf(OPERATIONS_DIR);
  });

  afterEach(() => {
    rmrf(OPERATIONS_DIR);
  });

  describe("writeOperationLog + readOperationLog roundtrip", () => {
    it("writes and reads back an operation with events", () => {
      const op = makeOperation(ID1);
      const events = [
        makeEvent(ID1, "status"),
        makeEvent(ID1, "output"),
        makeEvent(ID1, "complete"),
      ];

      writeOperationLog(op, events);
      const result = readOperationLog(ID1);

      expect(result).not.toBeNull();
      expect(result!.operation).toEqual(op);
      expect(result!.events).toHaveLength(3);
      expect(result!.events[0].type).toBe("status");
      expect(result!.events[1].type).toBe("output");
      expect(result!.events[2].type).toBe("complete");
    });

    it("stores file under workspace subdirectory", () => {
      const op = makeOperation(ID1, { workspace: "my-project" });
      writeOperationLog(op, []);

      expect(fs.existsSync(path.join(OPERATIONS_DIR, "my-project", `${ID1}.jsonl`))).toBe(true);
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

      writeOperationLog(op, events);
      const result = readOperationLog(ID2);

      expect(result!.events[0]).toEqual(events[0]);
    });

    it("reads with explicit workspace without scanning all dirs", () => {
      const op = makeOperation(ID1, { workspace: "ws-a" });
      writeOperationLog(op, [makeEvent(ID1)]);

      // Read with correct workspace
      expect(readOperationLog(ID1, "ws-a")).not.toBeNull();
      // Read with wrong workspace
      expect(readOperationLog(ID1, "ws-b")).toBeNull();
      // Read without workspace (scans all)
      expect(readOperationLog(ID1)).not.toBeNull();
    });
  });

  describe("readOperationLog", () => {
    it("returns null for nonexistent file", () => {
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

      writeOperationLog(op1, []);
      writeOperationLog(op2, []);
      writeOperationLog(op3, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(3);
      expect(ops[0].id).toBe(ID2); // newest
      expect(ops[1].id).toBe(ID3);
      expect(ops[2].id).toBe(ID1); // oldest
    });

    it("filters by workspace when provided", () => {
      writeOperationLog(makeOperation(ID1, { workspace: "ws-a" }), []);
      writeOperationLog(makeOperation(ID2, { workspace: "ws-b" }), []);
      writeOperationLog(makeOperation(ID3, { workspace: "ws-a" }), []);

      const opsA = listStoredOperations("ws-a");
      expect(opsA).toHaveLength(2);
      expect(opsA.every((op) => op.workspace === "ws-a")).toBe(true);

      const opsB = listStoredOperations("ws-b");
      expect(opsB).toHaveLength(1);
      expect(opsB[0].workspace).toBe("ws-b");

      // All workspaces
      expect(listStoredOperations()).toHaveLength(3);
    });

    it("skips corrupted files", () => {
      const op = makeOperation(ID1);
      writeOperationLog(op, []);

      // Write a corrupted file in the same workspace dir
      const wsDir = path.join(OPERATIONS_DIR, "test-workspace");
      fs.writeFileSync(path.join(wsDir, `${ID2}.jsonl`), "not valid json\n");

      const ops = listStoredOperations("test-workspace");
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe(ID1);
    });

    it("returns empty array when directory does not exist", () => {
      expect(listStoredOperations()).toEqual([]);
    });

    it("includes inputs in summaries when present", () => {
      const op = makeOperation(ID1, {
        inputs: { instruction: "Do something", description: "Details here" },
      });
      writeOperationLog(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toEqual({ instruction: "Do something", description: "Details here" });
    });

    it("omits inputs when operation has no inputs", () => {
      const op = makeOperation(ID1);
      writeOperationLog(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toBeUndefined();
    });
  });

  describe("deleteStoredOperation", () => {
    it("deletes an existing operation file", () => {
      const op = makeOperation(ID1);
      writeOperationLog(op, [makeEvent(ID1)]);

      expect(deleteStoredOperation(ID1)).toBe(true);
      expect(readOperationLog(ID1)).toBeNull();
    });

    it("deletes with explicit workspace", () => {
      const op = makeOperation(ID1, { workspace: "ws-x" });
      writeOperationLog(op, []);

      expect(deleteStoredOperation(ID1, "ws-x")).toBe(true);
      expect(readOperationLog(ID1, "ws-x")).toBeNull();
    });

    it("returns false for nonexistent operation", () => {
      expect(deleteStoredOperation("00000000-0000-4000-8000-000000999999")).toBe(false);
    });

    it("returns false for invalid ID", () => {
      expect(deleteStoredOperation("../../../etc/passwd")).toBe(false);
    });
  });

  describe("deleteStoredOperationsForWorkspace", () => {
    it("deletes all operations for a workspace", () => {
      writeOperationLog(makeOperation(ID1, { workspace: "ws-del" }), []);
      writeOperationLog(makeOperation(ID2, { workspace: "ws-del" }), []);
      writeOperationLog(makeOperation(ID3, { workspace: "ws-keep" }), []);

      const deleted = deleteStoredOperationsForWorkspace("ws-del");
      expect(deleted).toBe(true);

      expect(listStoredOperations("ws-del")).toHaveLength(0);
      expect(listStoredOperations("ws-keep")).toHaveLength(1);
      // Workspace directory itself should be gone
      expect(fs.existsSync(path.join(OPERATIONS_DIR, "ws-del"))).toBe(false);
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
      writeOperationLog(op, []);
      expect(fs.existsSync(OPERATIONS_DIR)).toBe(false);
    });

    it("rejects path traversal in workspace name", () => {
      const op = makeOperation(ID1, { workspace: "../../../etc" });
      writeOperationLog(op, []);
      expect(fs.existsSync(OPERATIONS_DIR)).toBe(false);
    });

    it("rejects IDs that don't match the pattern", () => {
      expect(readOperationLog("not-a-valid-id")).toBeNull();
      expect(readOperationLog("pipe-abc-def")).toBeNull();
      expect(readOperationLog("pipe-1")).toBeNull();
      expect(deleteStoredOperation("hack/../../../etc")).toBe(false);
    });

    it("accepts valid UUID IDs", () => {
      const op = makeOperation("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
      writeOperationLog(op, []);
      expect(readOperationLog("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")).not.toBeNull();
    });
  });
});
