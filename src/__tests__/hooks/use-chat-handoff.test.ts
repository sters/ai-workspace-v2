import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useChatHandoff } from "@/hooks/use-chat-handoff";
import { peekChatHandoff, stashChatHandoff } from "@/lib/chat-handoff";

beforeEach(() => {
  sessionStorage.clear();
});

describe("useChatHandoff", () => {
  it("reads the handoff stashed before the chat page opened", () => {
    stashChatHandoff("ws", { task: "fix it" });
    const { result } = renderHook(() => useChatHandoff("ws"));

    expect(result.current.handoff).toEqual({ task: "fix it" });
  });

  // The chat page of a workspace still being created can already be open when
  // the create finishes; navigating to its own URL does not remount it.
  it("picks up a handoff stashed while the chat page is already open, as a new terminal", () => {
    const { result } = renderHook(() => useChatHandoff("ws"));
    expect(result.current.handoff).toBeNull();
    const before = result.current.terminalKey;

    act(() => stashChatHandoff("ws", { task: "fix it" }));

    expect(result.current.handoff).toEqual({ task: "fix it" });
    expect(result.current.terminalKey).not.toBe(before);
  });

  it("ignores a handoff stashed for another workspace", () => {
    const { result } = renderHook(() => useChatHandoff("ws"));
    const before = result.current.terminalKey;

    act(() => stashChatHandoff("other", { task: "fix it" }));

    expect(result.current.handoff).toBeNull();
    expect(result.current.terminalKey).toBe(before);
  });

  it("clears the stored handoff once delivered", () => {
    stashChatHandoff("ws", { task: "fix it" });
    const { result } = renderHook(() => useChatHandoff("ws"));

    act(() => result.current.onHandoffDelivered?.());

    expect(peekChatHandoff("ws")).toBeNull();
  });
});
