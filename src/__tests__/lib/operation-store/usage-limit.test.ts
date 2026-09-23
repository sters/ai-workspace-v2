// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  getDb,
  _resetDb,
  _setDbPath,
  insertOperation,
  updateOperationStatus,
  updateOperationMeta,
} from "@/lib/db";
import { isUsageLimitMessage, listUsageLimitStops } from "@/lib/operation-store";
import type { Operation } from "@/types/operation";

const SESSION_LIMIT = "You've hit your session limit · resets 9:40pm (Asia/Tokyo)";

describe("isUsageLimitMessage", () => {
  it("recognizes the CLI's limit messages", () => {
    expect(isUsageLimitMessage(SESSION_LIMIT)).toBe(true);
    expect(
      isUsageLimitMessage("You've hit your weekly limit · resets Monday"),
    ).toBe(true);
    expect(isUsageLimitMessage("Claude usage limit reached")).toBe(true);
  });

  it("does not fire on a report that merely talks about limits", () => {
    // Failed operations end on prose as often as on a CLI error, and a review
    // report discussing rate limiting must not light up the sidebar.
    expect(
      isUsageLimitMessage(
        "Added a rate limit to the fetcher; the limit is configurable.",
      ),
    ).toBe(false);
    expect(isUsageLimitMessage(undefined)).toBe(false);
  });
});

function makeOp(id: string, workspace: string, startedAt: string): Operation {
  return { id, type: "autonomous", workspace, status: "running", startedAt };
}

/** Insert an operation that ended on `content`. */
function finish(
  id: string,
  workspace: string,
  startedAt: string,
  status: "completed" | "failed",
  content: string,
) {
  insertOperation(makeOp(id, workspace, startedAt));
  updateOperationStatus(id, status, `${startedAt.slice(0, -1)}.500Z`);
  updateOperationMeta(id, { resultSummary: { content } });
}

describe("listUsageLimitStops", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("reports the workspace whose latest operation hit the limit", () => {
    finish("op-1", "ws-stopped", "2026-01-01T00:00:00Z", "failed", SESSION_LIMIT);

    expect(listUsageLimitStops()).toEqual([
      {
        workspace: "ws-stopped",
        operationId: "op-1",
        message: SESSION_LIMIT,
        at: "2026-01-01T00:00:00.500Z",
      },
    ]);
  });

  it("says nothing once a later operation has run", () => {
    finish("old", "ws", "2026-01-01T00:00:00Z", "failed", SESSION_LIMIT);
    finish("new", "ws", "2026-01-02T00:00:00Z", "completed", "PR created");

    expect(listUsageLimitStops()).toEqual([]);
  });

  it("ignores a completed operation that mentions the message", () => {
    // The limit stops a run; an operation that finished cannot have been
    // stopped by it, whatever its last result says.
    finish("op", "ws", "2026-01-01T00:00:00Z", "completed", SESSION_LIMIT);

    expect(listUsageLimitStops()).toEqual([]);
  });

  it("ignores a failure with another cause", () => {
    finish("op", "ws", "2026-01-01T00:00:00Z", "failed", "Phase timed out");

    expect(listUsageLimitStops()).toEqual([]);
  });
});
