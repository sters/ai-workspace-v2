import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CHAT_HANDOFF_TTL_MS,
  clearChatHandoff,
  peekChatHandoff,
  stashChatHandoff,
} from "@/lib/chat-handoff";
import { buildSelectionTopic, type ChatSelection } from "@/lib/chat-selection";

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

describe("buildSelectionTopic", () => {
  const base: ChatSelection = {
    id: "1",
    repoPath: "github.com/acme/web",
    filePath: "src/a.ts",
    oldRange: [11, 11],
    newRange: [11, 12],
    text: "-old\n+new\n+more",
  };

  it("locates each selection relative to the workspace and quotes it as a diff", () => {
    const topic = buildSelectionTopic([base]);
    expect(topic).toContain("github.com/acme/web/src/a.ts, lines 11-12");
    expect(topic).toContain("```diff\n-old\n+new\n+more\n```");
  });

  it("numbers removed-only selections on the base side", () => {
    const topic = buildSelectionTopic([{ ...base, newRange: null, oldRange: [5, 5], text: "-gone" }]);
    expect(topic).toContain("src/a.ts, removed line 5 of the base version");
  });

  it("lengthens the fence when the quoted code contains one", () => {
    const topic = buildSelectionTopic([{ ...base, text: "+```ts\n+x\n+```" }]);
    expect(topic).toContain("````diff\n+```ts\n+x\n+```\n````");
  });

  it("keeps every selection, in the order they were added", () => {
    const topic = buildSelectionTopic([
      base,
      { ...base, id: "2", filePath: "src/b.ts", newRange: [3, 3], text: "+b" },
    ]);
    expect(topic.indexOf("src/a.ts")).toBeLessThan(topic.indexOf("src/b.ts"));
    expect(topic).toMatch(/1\. .*src\/a\.ts/);
    expect(topic).toMatch(/2\. .*src\/b\.ts, line 3/);
  });
});
