import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatSessionInfo } from "@/types/chat";

const mockData = vi.fn<() => ChatSessionInfo[] | undefined>();
vi.mock("swr", () => ({
  default: () => ({ data: mockData(), mutate: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({ fetcher: vi.fn() }));

import { useChatSessions } from "@/hooks/use-chat-sessions";

function session(
  workspaceId: string,
  busy: boolean | undefined,
  id = `chat-${workspaceId}-${String(busy)}`,
): ChatSessionInfo {
  return {
    id,
    workspaceId,
    startedAt: 0,
    ...(busy === undefined ? {} : { busy }),
  };
}

function activityFor(sessions: ChatSessionInfo[] | undefined) {
  mockData.mockReturnValue(sessions);
  return renderHook(() => useChatSessions()).result.current.chatActivity;
}

describe("useChatSessions", () => {
  beforeEach(() => {
    mockData.mockReset();
  });

  it("maps a busy session to busy and a quiet one to waiting", () => {
    const activity = activityFor([
      session("ws-busy", true),
      session("ws-quiet", false),
    ]);

    expect(activity.get("ws-busy")).toBe("busy");
    expect(activity.get("ws-quiet")).toBe("waiting");
  });

  it("reports unknown rather than waiting when the server omits busy", () => {
    const activity = activityFor([session("ws-old", undefined)]);

    expect(activity.get("ws-old")).toBe("unknown");
  });

  it("lets a working session outrank a quiet one in the same workspace", () => {
    const activity = activityFor([
      session("ws", false, "chat-1"),
      session("ws", true, "chat-2"),
    ]);

    expect(activity.get("ws")).toBe("busy");
  });

  it("lets a known state outrank an unknown one in the same workspace", () => {
    const activity = activityFor([
      session("ws", undefined, "chat-1"),
      session("ws", false, "chat-2"),
    ]);

    expect(activity.get("ws")).toBe("waiting");
  });

  it("holds no activity before the first response", () => {
    expect(activityFor(undefined).size).toBe(0);
  });
});
