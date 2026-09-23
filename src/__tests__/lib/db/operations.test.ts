// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertOperation,
  updateOperationStatus,
  updateOperationMeta,
  listLatestOperationPerWorkspace,
  listRecentFinishedOperations,
} from "@/lib/db";
import type { Operation } from "@/types/operation";

function makeOp(
  id: string,
  status: Operation["status"],
  startedAt: string,
  workspace = "ws-1",
): Operation {
  return {
    id,
    type: "execute",
    workspace,
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

describe("db/operations: listLatestOperationPerWorkspace", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("keeps only the newest operation of each workspace", () => {
    insertOperation(makeOp("a-old", "running", "2026-01-01T00:00:00Z", "ws-a"));
    updateOperationStatus("a-old", "failed", "2026-01-01T00:01:00Z");
    insertOperation(makeOp("a-new", "running", "2026-01-02T00:00:00Z", "ws-a"));
    updateOperationStatus("a-new", "completed", "2026-01-02T00:01:00Z");
    insertOperation(makeOp("b-only", "running", "2026-01-01T12:00:00Z", "ws-b"));
    updateOperationStatus("b-only", "failed", "2026-01-01T12:01:00Z");

    const latest = listLatestOperationPerWorkspace();
    expect(new Map(latest.map((o) => [o.workspace, o.id]))).toEqual(
      new Map([
        ["ws-a", "a-new"],
        ["ws-b", "b-only"],
      ]),
    );
  });

  it("counts a running operation as the newest one", () => {
    insertOperation(makeOp("done", "running", "2026-01-01T00:00:00Z", "ws"));
    updateOperationStatus("done", "failed", "2026-01-01T00:01:00Z");
    insertOperation(makeOp("live", "running", "2026-01-01T00:02:00Z", "ws"));

    expect(listLatestOperationPerWorkspace().map((o) => o.id)).toEqual(["live"]);
  });

  it("breaks a tie on start time by insertion order", () => {
    insertOperation(makeOp("first", "running", "2026-01-01T00:00:00Z", "ws"));
    updateOperationStatus("first", "completed", "2026-01-01T00:01:00Z");
    insertOperation(makeOp("second", "running", "2026-01-01T00:00:00Z", "ws"));
    updateOperationStatus("second", "failed", "2026-01-01T00:01:00Z");

    expect(listLatestOperationPerWorkspace().map((o) => o.id)).toEqual(["second"]);
  });

  it("carries the result summary through", () => {
    insertOperation(makeOp("op", "running", "2026-01-01T00:00:00Z", "ws"));
    updateOperationStatus("op", "failed", "2026-01-01T00:01:00Z");
    updateOperationMeta("op", { resultSummary: { content: "boom" } });

    expect(listLatestOperationPerWorkspace()[0]?.resultSummary?.content).toBe("boom");
  });
});
