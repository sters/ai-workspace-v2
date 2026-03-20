// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import {
  getDb,
  _resetDb,
  _setDbPath,
  insertOperation,
  getEvents,
  bufferEvent,
  flushEvents,
  startAutoFlush,
  stopAutoFlush,
} from "@/lib/db";
import type { Operation, OperationEvent } from "@/types/operation";

const OP_ID = "00000000-0000-4000-8000-000000000001";

function makeOp(): Operation {
  return {
    id: OP_ID,
    type: "execute",
    workspace: "test",
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

function makeEvent(i: number): OperationEvent {
  return {
    type: "status",
    operationId: OP_ID,
    data: `event-${i}`,
    timestamp: new Date().toISOString(),
  };
}

describe("db/event-buffer", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    insertOperation(makeOp());
  });

  it("bufferEvent + flushEvents writes to SQLite", () => {
    bufferEvent(OP_ID, makeEvent(1));
    bufferEvent(OP_ID, makeEvent(2));

    // Before flush, no events in DB
    expect(getEvents(OP_ID)).toHaveLength(0);

    flushEvents(OP_ID);

    // After flush, events are in DB
    const events = getEvents(OP_ID);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("event-1");
    expect(events[1].data).toBe("event-2");
  });

  it("auto-flushes when threshold reached", () => {
    // Buffer 50 events (threshold)
    for (let i = 0; i < 50; i++) {
      bufferEvent(OP_ID, makeEvent(i));
    }

    // Should have auto-flushed
    const events = getEvents(OP_ID);
    expect(events).toHaveLength(50);
  });

  it("stopAutoFlush performs final flush", () => {
    startAutoFlush(OP_ID);

    bufferEvent(OP_ID, makeEvent(1));
    bufferEvent(OP_ID, makeEvent(2));

    // Events are buffered, not yet in DB
    expect(getEvents(OP_ID)).toHaveLength(0);

    stopAutoFlush(OP_ID);

    // After stop, events should be flushed
    expect(getEvents(OP_ID)).toHaveLength(2);
  });

  it("flushEvents is idempotent for empty buffer", () => {
    flushEvents(OP_ID);
    flushEvents("nonexistent-id");
    // No errors thrown
  });
});
