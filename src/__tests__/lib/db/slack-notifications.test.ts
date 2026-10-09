// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { insertOperation, updateOperationStatus } from "@/lib/db/operations";
import {
  addPendingNotification,
  listReadyNotifications,
  deleteNotification,
} from "@/lib/db/slack-notifications";

function makeOp(id: string): void {
  insertOperation({
    id,
    type: "autonomous",
    workspace: "myws",
    status: "running",
    startedAt: new Date().toISOString(),
  });
}

describe("db/slack-notifications", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("listReadyNotifications excludes still-running operations", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C123", threadTs: "1.0" });
    expect(listReadyNotifications()).toEqual([]);
  });

  it("listReadyNotifications returns completed operations", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C123", threadTs: "1.0" });
    updateOperationStatus("op-1", "completed", new Date().toISOString());

    const ready = listReadyNotifications();
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      operationId: "op-1",
      channel: "C123",
      threadTs: "1.0",
      status: "completed",
    });
  });

  it("listReadyNotifications returns failed operations", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C2", threadTs: "2.0" });
    updateOperationStatus("op-1", "failed", new Date().toISOString());

    const ready = listReadyNotifications();
    expect(ready).toHaveLength(1);
    expect(ready[0].status).toBe("failed");
  });

  it("deleteNotification removes a pending row", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C", threadTs: "1.0" });
    updateOperationStatus("op-1", "completed", new Date().toISOString());

    expect(listReadyNotifications()).toHaveLength(1);
    deleteNotification("op-1");
    expect(listReadyNotifications()).toHaveLength(0);
  });

  it("ON DELETE CASCADE removes notifications when the operation row is deleted", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C", threadTs: "1.0" });
    updateOperationStatus("op-1", "completed", new Date().toISOString());

    const db = getDb();
    db.exec("DELETE FROM operations WHERE id = 'op-1'");

    expect(listReadyNotifications()).toEqual([]);
  });

  it("re-inserting for the same operationId replaces the row (PRIMARY KEY)", () => {
    makeOp("op-1");
    addPendingNotification({ operationId: "op-1", channel: "C1", threadTs: "1.0" });
    addPendingNotification({ operationId: "op-1", channel: "C2", threadTs: "2.0" });
    updateOperationStatus("op-1", "completed", new Date().toISOString());

    const ready = listReadyNotifications();
    expect(ready).toHaveLength(1);
    expect(ready[0].channel).toBe("C2");
    expect(ready[0].threadTs).toBe("2.0");
  });
});
