// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertOperation,
  updateOperationStatus,
  listRecentFinishedOperations,
} from "@/lib/db";
import type { Operation } from "@/types/operation";

function makeOp(id: string, status: Operation["status"], startedAt: string): Operation {
  return {
    id,
    type: "execute",
    workspace: "ws-1",
    status,
    startedAt,
  };
}

describe("db/operations: listRecentFinishedOperations", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("returns completed and failed operations, excluding running", () => {
    insertOperation(makeOp("op-completed", "running", "2026-01-01T00:00:00Z"));
    updateOperationStatus("op-completed", "completed", "2026-01-01T00:01:00Z");

    insertOperation(makeOp("op-failed", "running", "2026-01-01T00:02:00Z"));
    updateOperationStatus("op-failed", "failed", "2026-01-01T00:03:00Z");

    insertOperation(makeOp("op-running", "running", "2026-01-01T00:04:00Z"));

    const result = listRecentFinishedOperations(10);
    const ids = result.map((o) => o.id);
    expect(ids).toContain("op-completed");
    expect(ids).toContain("op-failed");
    expect(ids).not.toContain("op-running");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertOperation(makeOp(`op-${i}`, "running", `2026-01-01T00:0${i}:00Z`));
      updateOperationStatus(`op-${i}`, "completed", `2026-01-01T00:0${i}:30Z`);
    }
    const result = listRecentFinishedOperations(3);
    expect(result).toHaveLength(3);
  });

  it("orders by completed_at descending (newest first)", () => {
    insertOperation(makeOp("op-old", "running", "2026-01-01T00:00:00Z"));
    updateOperationStatus("op-old", "completed", "2026-01-01T00:01:00Z");

    insertOperation(makeOp("op-mid", "running", "2026-01-02T00:00:00Z"));
    updateOperationStatus("op-mid", "failed", "2026-01-02T00:01:00Z");

    insertOperation(makeOp("op-new", "running", "2026-01-03T00:00:00Z"));
    updateOperationStatus("op-new", "completed", "2026-01-03T00:01:00Z");

    const result = listRecentFinishedOperations(10);
    expect(result.map((o) => o.id)).toEqual(["op-new", "op-mid", "op-old"]);
  });

  it("returns an empty array when no finished operations exist", () => {
    insertOperation(makeOp("op-running", "running", "2026-01-01T00:00:00Z"));
    expect(listRecentFinishedOperations(10)).toEqual([]);
  });
});
