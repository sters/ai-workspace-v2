// @vitest-environment node
/**
 * An operation the server was killed mid-run never had its result written, but
 * its events were flushed as they arrived — so the result is still derivable,
 * and the card would otherwise show nothing until it is expanded.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  getDb,
  _resetDb,
  _setDbPath,
  insertOperation,
  appendEvents,
  updateOperationMeta,
  listRecentFinishedOperations,
} from "@/lib/db";
import { backfillResultSummary } from "@/lib/operation-store";
import type { Operation, OperationEvent } from "@/types/operation";

const OP_ID = "00000000-0000-4000-8000-000000000001";

function makeOp(overrides?: Partial<Operation>): Operation {
  return {
    id: OP_ID,
    type: "autonomous",
    workspace: "test-ws",
    status: "failed",
    startedAt: "2026-09-23T14:00:00.000Z",
    completedAt: "2026-09-23T14:44:16.330Z",
    children: [],
    phases: [{ index: 0, label: "Cycle 1: Execute", status: "running" }],
    ...overrides,
  };
}

function resultEvent(content: string, childLabel?: string): OperationEvent {
  return {
    type: "output",
    operationId: OP_ID,
    data: JSON.stringify({
      type: "result",
      subtype: "success",
      result: content,
      total_cost_usd: 1.25,
      duration_ms: 3000,
    }),
    timestamp: "2026-09-23T14:44:00.000Z",
    phaseIndex: 0,
    ...(childLabel && { childLabel }),
  };
}

describe("backfillResultSummary", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("writes the result derived from the persisted events", () => {
    insertOperation(makeOp());
    appendEvents([resultEvent("Implemented 3 of 5 TODO items.")]);

    const filled = backfillResultSummary(OP_ID);

    expect(filled?.content).toBe("Implemented 3 of 5 TODO items.");
    expect(listRecentFinishedOperations(10)[0].resultSummary?.content).toBe(
      "Implemented 3 of 5 TODO items.",
    );
  });

  it("keeps every child's result of the final phase", () => {
    insertOperation(makeOp());
    appendEvents([resultEvent("No PR was created.", "repo-a"), resultEvent("PR: url", "repo-b")]);

    backfillResultSummary(OP_ID);

    const results = listRecentFinishedOperations(10)[0].resultSummary?.results;
    expect(results?.map((r) => r.label)).toEqual(["repo-a", "repo-b"]);
  });

  it("leaves a summary written at completion untouched", () => {
    insertOperation(makeOp());
    updateOperationMeta(OP_ID, { resultSummary: { content: "written at completion" } });
    appendEvents([resultEvent("derived later")]);

    expect(backfillResultSummary(OP_ID)).toBeUndefined();
    expect(listRecentFinishedOperations(10)[0].resultSummary?.content).toBe(
      "written at completion",
    );
  });

  it("does nothing for an operation whose events carry no result", () => {
    insertOperation(makeOp());
    appendEvents([
      { type: "status", operationId: OP_ID, data: "Phase 1/1", timestamp: "2026-09-23T14:00:00.000Z" },
    ]);

    expect(backfillResultSummary(OP_ID)).toBeUndefined();
    expect(listRecentFinishedOperations(10)[0].resultSummary).toBeUndefined();
  });

  it("does not resurrect an operation that is still running", () => {
    insertOperation(makeOp({ status: "running", completedAt: undefined }));
    appendEvents([resultEvent("a phase result, mid-run")]);

    expect(backfillResultSummary(OP_ID)).toBeUndefined();
  });
});
