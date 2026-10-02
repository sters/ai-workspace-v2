import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CHAT_HANDOFF_TTL_MS,
  clearChatHandoff,
  peekChatHandoff,
  stashChatHandoff,
} from "@/lib/chat-handoff";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat handoff", () => {
  it("is read back until it is cleared, so a reload before delivery still applies it", () => {
    stashChatHandoff("ws", { task: "fix it" }, 1000);
    expect(peekChatHandoff("ws", 1000)).toEqual({ task: "fix it" });
    expect(peekChatHandoff("ws", 2000)).toEqual({ task: "fix it" });

    clearChatHandoff("ws");
    expect(peekChatHandoff("ws", 2000)).toBeNull();
  });

  it("belongs to the workspace it was stashed for", () => {
    stashChatHandoff("ws-a", { discussion: "look here" }, 1000);
    expect(peekChatHandoff("ws-b", 1000)).toBeNull();
  });

  it("expires, so an undelivered handoff does not start a session on a later visit", () => {
    stashChatHandoff("ws", { task: "fix it" }, 1000);
    expect(peekChatHandoff("ws", 1000 + CHAT_HANDOFF_TTL_MS + 1)).toBeNull();
    // And it is gone, not just hidden.
    expect(peekChatHandoff("ws", 1000)).toBeNull();
  });

  it("treats an unreadable entry as absent", () => {
    sessionStorage.setItem("aiw-chat-handoff:ws", "{not json");
    expect(peekChatHandoff("ws")).toBeNull();
  });
});
