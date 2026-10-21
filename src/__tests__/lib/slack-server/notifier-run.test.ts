// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { insertOperation, updateOperationStatus, updateOperationWorkspace } from "@/lib/db/operations";
import { addPendingNotification, listReadyNotifications } from "@/lib/db/slack-notifications";
import { startNotifier, type Notifier } from "@/lib/slack-server/notifier";
import type { OperationType } from "@/types/operation";

function makeOp(id: string, type: OperationType, workspace = ""): void {
  insertOperation({ id, type, workspace, status: "running", startedAt: new Date().toISOString() });
}

function slackClient() {
  return {
    chat: {
      update: vi.fn(async () => ({ ok: true })),
      postMessage: vi.fn(async () => ({ ok: true, ts: "9.9" })),
    },
  };
}

describe("notifier status message", () => {
  let client: ReturnType<typeof slackClient>;
  let notifier: Notifier;

  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
    client = slackClient();
    notifier = startNotifier({ client: client as never, intervalMs: 60_000 });
  });

  afterEach(() => notifier.stop());

  it("edits the status message up to done and posts the result as a new message", async () => {
    makeOp("op-1", "autonomous");
    addPendingNotification({ operationId: "op-1", channel: "C", threadTs: "1.0", messageTs: "1.5" });

    await notifier.runOnce();
    expect(client.chat.update).not.toHaveBeenCalled();

    updateOperationWorkspace("op-1", "feature-x-20261021");
    await notifier.runOnce();
    await notifier.runOnce();
    expect(client.chat.update).toHaveBeenCalledTimes(1);
    expect(client.chat.update).toHaveBeenLastCalledWith({
      channel: "C",
      ts: "1.5",
      text: "Created `feature-x-20261021`.\n\n⏳ Working…",
    });

    updateOperationStatus("op-1", "completed", new Date().toISOString());
    await notifier.runOnce();
    expect(client.chat.update).toHaveBeenLastCalledWith({
      channel: "C",
      ts: "1.5",
      text: "Created `feature-x-20261021`.\n\n✅ Done.",
    });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage).toHaveBeenCalledWith({
      channel: "C",
      thread_ts: "1.0",
      text: "Done! No PRs were created. Please check details on WebUI.",
    });
    expect(listReadyNotifications()).toEqual([]);
  });

  it("keeps a bound thread's header instead of announcing a created workspace", async () => {
    makeOp("op-1", "update-todo", "bound-ws");
    addPendingNotification({
      operationId: "op-1",
      channel: "C",
      threadTs: "1.0",
      messageTs: "1.5",
      statusHeader: "Working in `bound-ws`.",
    });

    await notifier.runOnce();
    expect(client.chat.update).not.toHaveBeenCalled();

    updateOperationStatus("op-1", "completed", new Date().toISOString());
    await notifier.runOnce();
    const status = (client.chat.update.mock.calls.at(-1) as unknown as [{ text: string }])[0].text;
    expect(status).toBe("Working in `bound-ws`.\n\n✅ Done.");
    const result = (client.chat.postMessage.mock.calls.at(-1) as unknown as [{ text: string }])[0].text;
    expect(result.startsWith("Done!")).toBe(true);
    expect(result).not.toContain("No PRs");
  });

  it("marks the status message failed and posts the failure when the run fails", async () => {
    makeOp("op-1", "autonomous", "feature-x-20261021");
    addPendingNotification({ operationId: "op-1", channel: "C", threadTs: "1.0", messageTs: "1.5" });
    updateOperationStatus("op-1", "failed", new Date().toISOString());

    await notifier.runOnce();
    const status = (client.chat.update.mock.calls.at(-1) as unknown as [{ text: string }])[0].text;
    expect(status).toBe("Created `feature-x-20261021`.\n\n❌ Failed.");
    const result = (client.chat.postMessage.mock.calls.at(-1) as unknown as [{ text: string }])[0].text;
    expect(result).toContain("failed");
  });

  it("stays silent about a failure with no status message to correct", async () => {
    makeOp("op-1", "autonomous", "feature-x-20261021");
    addPendingNotification({ operationId: "op-1", channel: "C", threadTs: "1.0" });
    updateOperationStatus("op-1", "failed", new Date().toISOString());

    await notifier.runOnce();
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });
});
