import { describe, expect, it, vi } from "vitest";
import type { ChatSessionInfo } from "@/types/chat";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ server: { chatPort: 3742 } }),
}));

function chatServerListing(sessions: Partial<ChatSessionInfo>[]): typeof fetch {
  return (async () => new Response(JSON.stringify(sessions))) as unknown as typeof fetch;
}

describe("isThreadOpenInWebUi", () => {
  it("is true while a live chat continues the thread", async () => {
    const { isThreadOpenInWebUi } = await import("@/lib/slack-server/webui-attach");
    const fetchFn = chatServerListing([
      { id: "chat-1", workspaceId: "ws-a" },
      { id: "chat-2", workspaceId: "ws-a", slackThread: "t1" },
    ]);
    expect(await isThreadOpenInWebUi("t1", fetchFn)).toBe(true);
    expect(await isThreadOpenInWebUi("t2", fetchFn)).toBe(false);
  });

  it("is false when the chat server cannot be reached, so Slack keeps answering", async () => {
    const { isThreadOpenInWebUi } = await import("@/lib/slack-server/webui-attach");
    const fetchFn = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await isThreadOpenInWebUi("t1", fetchFn)).toBe(false);
  });
});
