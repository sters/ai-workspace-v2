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
      const op = makeOperation("pipe-1-1000");
      const events = [
        makeEvent("pipe-1-1000", "status"),
        makeEvent("pipe-1-1000", "output"),
        makeEvent("pipe-1-1000", "complete"),
      ];

      writeOperationLog(op, events);
      const result = readOperationLog("pipe-1-1000");

      expect(result).not.toBeNull();
      expect(result!.operation).toEqual(op);
      expect(result!.events).toHaveLength(3);
      expect(result!.events[0].type).toBe("status");
      expect(result!.events[1].type).toBe("output");
      expect(result!.events[2].type).toBe("complete");
    });

    it("stores file under workspace subdirectory", () => {
      const op = makeOperation("pipe-1-1000", { workspace: "my-project" });
      writeOperationLog(op, []);

      expect(fs.existsSync(path.join(OPERATIONS_DIR, "my-project", "pipe-1-1000.jsonl"))).toBe(true);
    });

    it("preserves event fields through roundtrip", () => {
      const op = makeOperation("pipe-2-2000");
      const events: OperationEvent[] = [
        {
          type: "status",
          operationId: "pipe-2-2000",
          data: "Phase 1/2: Setup",
          timestamp: "2024-01-01T00:00:00.000Z",
          childLabel: "setup",
          phaseIndex: 0,
          phaseLabel: "Setup",
        },
      ];

      writeOperationLog(op, events);
      const result = readOperationLog("pipe-2-2000");

      expect(result!.events[0]).toEqual(events[0]);
    });

    it("reads with explicit workspace without scanning all dirs", () => {
      const op = makeOperation("pipe-1-1000", { workspace: "ws-a" });
      writeOperationLog(op, [makeEvent("pipe-1-1000")]);

      // Read with correct workspace
      expect(readOperationLog("pipe-1-1000", "ws-a")).not.toBeNull();
      // Read with wrong workspace
      expect(readOperationLog("pipe-1-1000", "ws-b")).toBeNull();
      // Read without workspace (scans all)
      expect(readOperationLog("pipe-1-1000")).not.toBeNull();
    });
  });

  describe("readOperationLog", () => {
    it("returns null for nonexistent file", () => {
      expect(readOperationLog("pipe-999-9999")).toBeNull();
    });

    it("returns null for invalid operation ID", () => {
      expect(readOperationLog("../../../etc/passwd")).toBeNull();
      expect(readOperationLog("invalid-id")).toBeNull();
    });
  });

  describe("listStoredOperations", () => {
    it("returns operations sorted by startedAt descending", () => {
      const op1 = makeOperation("pipe-1-1000", {
        startedAt: "2024-01-01T00:00:00.000Z",
      });
      const op2 = makeOperation("pipe-2-2000", {
        startedAt: "2024-01-03T00:00:00.000Z",
      });
      const op3 = makeOperation("pipe-3-3000", {
        startedAt: "2024-01-02T00:00:00.000Z",
      });

      writeOperationLog(op1, []);
      writeOperationLog(op2, []);
      writeOperationLog(op3, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(3);
      expect(ops[0].id).toBe("pipe-2-2000"); // newest
      expect(ops[1].id).toBe("pipe-3-3000");
      expect(ops[2].id).toBe("pipe-1-1000"); // oldest
    });

    it("filters by workspace when provided", () => {
      writeOperationLog(makeOperation("pipe-1-1000", { workspace: "ws-a" }), []);
      writeOperationLog(makeOperation("pipe-2-2000", { workspace: "ws-b" }), []);
      writeOperationLog(makeOperation("pipe-3-3000", { workspace: "ws-a" }), []);

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
      const op = makeOperation("pipe-1-1000");
      writeOperationLog(op, []);

      // Write a corrupted file in the same workspace dir
      const wsDir = path.join(OPERATIONS_DIR, "test-workspace");
      fs.writeFileSync(path.join(wsDir, "pipe-2-2000.jsonl"), "not valid json\n");

      const ops = listStoredOperations("test-workspace");
      expect(ops).toHaveLength(1);
      expect(ops[0].id).toBe("pipe-1-1000");
    });

    it("returns empty array when directory does not exist", () => {
      expect(listStoredOperations()).toEqual([]);
    });

    it("includes inputs in summaries when present", () => {
      const op = makeOperation("pipe-1-1000", {
        inputs: { instruction: "Do something", description: "Details here" },
      });
      writeOperationLog(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toEqual({ instruction: "Do something", description: "Details here" });
    });

    it("omits inputs when operation has no inputs", () => {
      const op = makeOperation("pipe-1-1000");
      writeOperationLog(op, []);

      const ops = listStoredOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0].inputs).toBeUndefined();
    });
  });

  describe("deleteStoredOperation", () => {
    it("deletes an existing operation file", () => {
      const op = makeOperation("pipe-1-1000");
      writeOperationLog(op, [makeEvent("pipe-1-1000")]);

      expect(deleteStoredOperation("pipe-1-1000")).toBe(true);
      expect(readOperationLog("pipe-1-1000")).toBeNull();
    });

    it("deletes with explicit workspace", () => {
      const op = makeOperation("pipe-1-1000", { workspace: "ws-x" });
      writeOperationLog(op, []);

      expect(deleteStoredOperation("pipe-1-1000", "ws-x")).toBe(true);
      expect(readOperationLog("pipe-1-1000", "ws-x")).toBeNull();
    });

    it("returns false for nonexistent operation", () => {
      expect(deleteStoredOperation("pipe-999-9999")).toBe(false);
    });

    it("returns false for invalid ID", () => {
      expect(deleteStoredOperation("../../../etc/passwd")).toBe(false);
    });
  });

  describe("deleteStoredOperationsForWorkspace", () => {
    it("deletes all operations for a workspace", () => {
      writeOperationLog(makeOperation("pipe-1-1000", { workspace: "ws-del" }), []);
      writeOperationLog(makeOperation("pipe-2-2000", { workspace: "ws-del" }), []);
      writeOperationLog(makeOperation("pipe-3-3000", { workspace: "ws-keep" }), []);

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
      const op = makeOperation("pipe-1-1000", { workspace: "../../../etc" });
      writeOperationLog(op, []);
      expect(fs.existsSync(OPERATIONS_DIR)).toBe(false);
    });

    it("rejects IDs that don't match the pattern", () => {
      expect(readOperationLog("not-a-valid-id")).toBeNull();
      expect(readOperationLog("pipe-abc-def")).toBeNull();
      expect(readOperationLog("pipe-1")).toBeNull();
      expect(deleteStoredOperation("hack/../../../etc")).toBe(false);
    });

    it("accepts valid pipe IDs", () => {
      const op = makeOperation("pipe-42-1709312345678");
      writeOperationLog(op, []);
      expect(readOperationLog("pipe-42-1709312345678")).not.toBeNull();
    });
  });
});
