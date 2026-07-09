import { describe, expect, it } from "vitest";
import { buildSlackChatPrompt, getSlackChatSystemPrompt } from "@/lib/templates/prompts/slack-chat";

describe("getSlackChatSystemPrompt", () => {
  it("defaults to read-only but permits explicitly-requested writes", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toContain("READ-ONLY");
    // Writes are gated on an explicit user request, not the model's initiative.
    expect(sys).toMatch(/EXPLICIT/);
    expect(sys).toMatch(/MCP/);
  });

  it("keeps repository/codebase changes and destructive actions forbidden even on request", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/NEVER/);
    expect(sys).toMatch(/git/);
    // Irreversible/destructive operations stay off-limits.
    expect(sys).toMatch(/reset --hard|force-push|rm -rf/);
    // Code changes are routed to the WebUI / init instead.
    expect(sys).toMatch(/WebUI|init/);
  });

  it("lets the model read and write the per-user memory database", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/MEMORY/);
    expect(sys).toContain("memories");
    expect(sys).toMatch(/EXPLICITLY/);
  });
});

describe("buildSlackChatPrompt", () => {
  it("returns only the message on resume turns", () => {
    expect(buildSlackChatPrompt("/ws", "hi again", false)).toBe("hi again");
  });

  it("includes the working directory and the message on the first turn", () => {
    const out = buildSlackChatPrompt("/ws", "what is up?", true);
    expect(out).toContain("/ws");
    expect(out).toContain("repositories/");
    expect(out).toContain("what is up?");
    expect(out).not.toContain("Slack thread so far");
  });

  it("folds thread context into the first turn when provided", () => {
    const out = buildSlackChatPrompt("/ws", "summarize this thread", true, {
      threadContext: "@U1: hello\n@U2: world",
    });
    expect(out).toContain("Slack thread so far");
    expect(out).toContain("@U1: hello");
    expect(out).toContain("@U2: world");
    // Thread context comes before the user's message section.
    expect(out.indexOf("@U1: hello")).toBeLessThan(out.indexOf("summarize this thread"));
  });

  it("ignores empty thread context on the first turn", () => {
    const out = buildSlackChatPrompt("/ws", "hi", true, { threadContext: "   " });
    expect(out).not.toContain("Slack thread so far");
  });

  it("ignores thread context on resume turns", () => {
    expect(buildSlackChatPrompt("/ws", "hi", false, { threadContext: "@U1: ctx" })).toBe("hi");
  });

  describe("memory context", () => {
    it("folds the memory DB path and user id into the first turn", () => {
      const out = buildSlackChatPrompt("/ws", "hi", true, {
        memoryDbPath: "/ws/.ai-workspace/slack-memory.sqlite",
        userId: "U123",
      });
      expect(out).toContain("Your memory about this user");
      expect(out).toContain("/ws/.ai-workspace/slack-memory.sqlite");
      expect(out).toContain("U123");
      expect(out).toContain("memories");
      // Scoped query for recall, scoped insert for remembering.
      expect(out).toMatch(/SELECT content FROM memories WHERE user_id='U123'/);
      expect(out).toMatch(/INSERT INTO memories\(user_id, content\)/);
    });

    it("omits memory when the user id is missing", () => {
      const out = buildSlackChatPrompt("/ws", "hi", true, {
        memoryDbPath: "/ws/.ai-workspace/slack-memory.sqlite",
      });
      expect(out).not.toContain("Your memory about this user");
    });

    it("omits memory when the DB path is missing", () => {
      const out = buildSlackChatPrompt("/ws", "hi", true, { userId: "U123" });
      expect(out).not.toContain("Your memory about this user");
    });

    it("does not fold memory into resume turns", () => {
      const out = buildSlackChatPrompt("/ws", "hi", false, {
        memoryDbPath: "/ws/.ai-workspace/slack-memory.sqlite",
        userId: "U123",
      });
      expect(out).toBe("hi");
    });
  });
});
