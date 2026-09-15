import { describe, expect, it } from "vitest";
import { buildSlackChatPrompt, getSlackChatSystemPrompt } from "@/lib/templates/prompts/slack-chat";

describe("getSlackChatSystemPrompt", () => {
  it("gates a write on an explicit request rather than the model's initiative", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toContain("READ-ONLY");
    expect(sys).toContain("WRITES REQUIRE AN EXPLICIT REQUEST");
  });

  it("keeps repository changes and destructive actions forbidden even on request", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/NEVER run repo-mutating commands/);
    expect(sys).toMatch(/reset --hard|force-push|rm -rf/);
    expect(sys).toContain("through the WebUI or");
  });

  it("names the scratch directory as the only place file writes may go", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/scratch directory/i);
    expect(sys).toMatch(/Everything else under the ai-workspace root is read-only/);
    expect(sys).toContain("`workspace/`");
    expect(sys).toContain("`repositories/`");
  });

  it("says a file invented under workspace/ does not create a workspace", () => {
    // The recorded failure this outlet exists for: asked to review a PR, the
    // conversation wrote `workspace/<name>.yml`, which the WebUI's listing skips
    // and hard limit (2) forbids it from deleting afterwards.
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/does not create a workspace/);
    expect(sys).toMatch(/Pull Requests tab/);
    expect(sys).toContain("init <description>");
  });

  it("scopes memory writes to the memories table and an explicit request", () => {
    const sys = getSlackChatSystemPrompt();
    expect(sys).toMatch(/write to its `memories` table/);
    expect(sys).toMatch(/Only write \(remember\) when the user EXPLICITLY asks/);
    expect(sys).toMatch(/NEVER `DROP`\/`ALTER`/);
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

  describe("scratch directory", () => {
    it("folds the scratch directory path into the first turn", () => {
      const out = buildSlackChatPrompt("/ws", "keep a note for me", true, {
        scratchDir: "/ws/.ai-workspace/slack-scratch/1712345678.123456",
      });
      expect(out).toContain("/ws/.ai-workspace/slack-scratch/1712345678.123456");
      // The directory is created on demand, so say so rather than assuming it exists.
      expect(out).toMatch(/mkdir -p/);
    });

    it("omits the scratch section when no directory is given", () => {
      const out = buildSlackChatPrompt("/ws", "hi", true);
      expect(out).not.toMatch(/scratch/i);
    });

    it("does not fold the scratch directory into resume turns", () => {
      const out = buildSlackChatPrompt("/ws", "hi", false, {
        scratchDir: "/ws/.ai-workspace/slack-scratch/1712345678.123456",
      });
      expect(out).toBe("hi");
    });
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
