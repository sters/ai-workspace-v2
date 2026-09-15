import { describe, it, expect, beforeEach, vi } from "vitest";
import { CHAT_BUSY_IDLE_MS, CHAT_NOTIFY_MIN_WORK_MS } from "@/lib/chat-server/constants";

const sendChatWaitingNotification = vi.fn();
vi.mock("@/lib/web-push", () => ({
  sendChatWaitingNotification: (...args: unknown[]) => sendChatWaitingNotification(...args),
}));

const NOW = 1_700_000_000_000;

function seed(...ids: string[]) {
  const sessions = new Map<string, unknown>();
  for (const id of ids) {
    sessions.set(id, {
      id,
      workspaceId: `ws-${id}`,
      exited: false,
      lastInputAt: NOW - CHAT_BUSY_IDLE_MS - CHAT_NOTIFY_MIN_WORK_MS - 1000,
      lastOutputAt: NOW - CHAT_BUSY_IDLE_MS,
      waitingDecidedForOutputAt: null,
    });
  }
  (globalThis as unknown as { __chatSessions: Map<string, unknown> }).__chatSessions = sessions;
}

describe("notifyWaitingSessions", () => {
  beforeEach(() => {
    sendChatWaitingNotification.mockReset();
  });

  it("notifies with the session and its workspace", async () => {
    seed("chat-1");
    const { notifyWaitingSessions } = await import("@/lib/chat-server/waiting-notifier");

    notifyWaitingSessions(NOW);
    expect(sendChatWaitingNotification).toHaveBeenCalledWith("chat-1", "ws-chat-1");
  });

  it("still notifies the rest when one send throws", async () => {
    seed("chat-1", "chat-2");
    sendChatWaitingNotification.mockImplementationOnce(() => {
      throw new Error("no vapid keys");
    });
    const { notifyWaitingSessions } = await import("@/lib/chat-server/waiting-notifier");

    expect(() => notifyWaitingSessions(NOW)).not.toThrow();
    expect(sendChatWaitingNotification).toHaveBeenCalledTimes(2);
  });
});
