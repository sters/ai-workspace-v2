import { describe, expect, it } from "vitest";
import { parseStreamEvent } from "@/lib/stream-parser";

describe("parseStreamEvent", () => {
  it("returns raw entry for unparseable JSON", () => {
    const entries = parseStreamEvent("not json at all");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("raw");
    if (entries[0].kind === "raw") {
      expect(entries[0].content).toBe("not json at all");
    }
  });

  describe("auth_status messages", () => {
    it("returns empty for successful auth", () => {
      const entries = parseStreamEvent(JSON.stringify({ type: "auth_status" }));
      expect(entries).toEqual([]);
    });

    it("returns error for failed auth", () => {
      const entries = parseStreamEvent(
        JSON.stringify({ type: "auth_status", error: "token_expired" })
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("error");
      if (entries[0].kind === "error") {
        expect(entries[0].content).toContain("Authentication failed");
        expect(entries[0].content).toContain("token_expired");
      }
    });
  });

  describe("assistant messages", () => {
    it("parses text blocks", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("text");
      if (entries[0].kind === "text") {
        expect(entries[0].content).toBe("Hello world");
      }
    });

    it("parses thinking blocks", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [{ type: "thinking", thinking: "Let me consider..." }],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("thinking");
      if (entries[0].kind === "thinking") {
        expect(entries[0].content).toBe("Let me consider...");
      }
    });

    it("parses tool_use blocks with summary", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              id: "tool-1",
              input: { command: "ls -la" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("tool_call");
      if (entries[0].kind === "tool_call") {
        expect(entries[0].toolName).toBe("Bash");
        expect(entries[0].toolId).toBe("tool-1");
        expect(entries[0].summary).toBe("$ ls -la");
      }
    });

    it("summarizes Read tool with file_path", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              id: "tool-2",
              input: { file_path: "/src/index.ts" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_call") {
        expect(entries[0].summary).toBe("/src/index.ts");
      }
    });

    it("summarizes Glob tool with pattern", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Glob",
              id: "tool-3",
              input: { pattern: "**/*.ts" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_call") {
        expect(entries[0].summary).toBe("**/*.ts");
      }
    });

    it("summarizes Grep tool with pattern", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Grep",
              id: "tool-4",
              input: { pattern: "TODO" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_call") {
        expect(entries[0].summary).toBe("/TODO/");
      }
    });

    it("summarizes unknown tools with empty string", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "CustomTool",
              id: "tool-5",
              input: { foo: "bar" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_call") {
        expect(entries[0].summary).toBe("");
      }
    });

    it("parses AskUserQuestion as ask entry", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "ask-1",
              input: {
                questions: [
                  {
                    question: "Which option?",
                    options: [{ label: "A", description: "Option A" }],
                    multiSelect: false,
                  },
                ],
              },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("ask");
      if (entries[0].kind === "ask") {
        expect(entries[0].toolId).toBe("ask-1");
        expect(entries[0].questions).toHaveLength(1);
        expect(entries[0].questions[0].question).toBe("Which option?");
        expect(entries[0].questions[0].multiSelect).toBe(false);
      }
    });

    it("parses multiple content blocks in a single message", () => {
      const msg = {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Thinking..." },
            { type: "text", text: "Response" },
            {
              type: "tool_use",
              name: "Bash",
              id: "t1",
              input: { command: "echo hi" },
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(3);
      expect(entries[0].kind).toBe("thinking");
      expect(entries[1].kind).toBe("text");
      expect(entries[2].kind).toBe("tool_call");
    });

    it("propagates parent_tool_use_id", () => {
      const msg = {
        type: "assistant",
        parent_tool_use_id: "parent-123",
        message: {
          content: [{ type: "text", text: "child output" }],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries[0].parentToolUseId).toBe("parent-123");
    });

    it("includes error entry when assistant message has error field", () => {
      const msg = {
        type: "assistant",
        error: "authentication_failed",
        message: {
          content: [{ type: "text", text: "some text" }],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      const errorEntry = entries.find((e) => e.kind === "error");
      expect(errorEntry).toBeDefined();
      if (errorEntry && errorEntry.kind === "error") {
        expect(errorEntry.content).toContain("authentication_failed");
        expect(errorEntry.content).toContain("claude login");
      }
    });
  });

  describe("user messages (tool results)", () => {
    it("parses string tool_result content", () => {
      const msg = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "command output here",
              is_error: false,
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("tool_result");
      if (entries[0].kind === "tool_result") {
        expect(entries[0].toolId).toBe("tool-1");
        expect(entries[0].content).toBe("command output here");
        expect(entries[0].isError).toBe(false);
      }
    });

    it("parses array tool_result content", () => {
      const msg = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-2",
              content: [{ text: "line 1" }, { text: "line 2" }],
              is_error: false,
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_result") {
        expect(entries[0].content).toBe("line 1\nline 2");
      }
    });

    it("marks error results", () => {
      const msg = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-3",
              content: "Error: something failed",
              is_error: true,
            },
          ],
        },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_result") {
        expect(entries[0].isError).toBe(true);
      }
    });
  });

  describe("tool_progress messages", () => {
    it("parses tool progress events", () => {
      const msg = {
        type: "tool_progress",
        tool_use_id: "tool-1",
        tool_name: "Bash",
        elapsed_time_seconds: 5.2,
        task_id: "task-1",
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("tool_progress");
      if (entries[0].kind === "tool_progress") {
        expect(entries[0].toolUseId).toBe("tool-1");
        expect(entries[0].toolName).toBe("Bash");
        expect(entries[0].elapsed).toBe(5.2);
        expect(entries[0].taskId).toBe("task-1");
      }
    });

    it("defaults elapsed to 0 when missing", () => {
      const msg = {
        type: "tool_progress",
        tool_use_id: "tool-1",
        tool_name: "Bash",
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "tool_progress") {
        expect(entries[0].elapsed).toBe(0);
      }
    });
  });

  describe("result messages", () => {
    it("parses successful result with cost and duration", () => {
      const msg = {
        type: "result",
        subtype: "success",
        result: "Task completed successfully",
        total_cost_usd: 0.1234,
        duration_ms: 5500,
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("result");
      if (entries[0].kind === "result") {
        expect(entries[0].content).toBe("Task completed successfully");
        expect(entries[0].cost).toBe("$0.1234");
        expect(entries[0].duration).toBe("5.5s");
      }
    });

    it("shows 'Completed' for success with no result text", () => {
      const msg = {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.05,
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "result") {
        expect(entries[0].content).toBe("Completed");
      }
    });

    it("shows error subtype for error with no details", () => {
      const msg = {
        type: "result",
        subtype: "error_timeout",
        total_cost_usd: 0.01,
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "result") {
        expect(entries[0].content).toBe("Error: error_timeout");
      }
    });

    it("includes errors array in result content", () => {
      const msg = {
        type: "result",
        subtype: "error",
        is_error: true,
        errors: ["Error 1", "Error 2"],
        total_cost_usd: 0.02,
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "result") {
        expect(entries[0].content).toContain("Error 1");
        expect(entries[0].content).toContain("Error 2");
      }
    });
  });

  describe("system messages", () => {
    it("handles initializing subtype", () => {
      const msg = { type: "system", subtype: "initializing" };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("system");
      if (entries[0].kind === "system") {
        expect(entries[0].content).toBe("Session initializing...");
      }
    });

    it("handles init subtype with model and session", () => {
      const msg = {
        type: "system",
        subtype: "init",
        model: "claude-3-opus",
        session_id: "sess-abc",
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "system") {
        expect(entries[0].content).toContain("claude-3-opus");
        expect(entries[0].content).toContain("sess-abc");
      }
    });

    it("handles task_started subtype", () => {
      const msg = {
        type: "system",
        subtype: "task_started",
        description: "Running tests",
        tool_use_id: "tool-abc",
        task_id: "task-1",
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "system") {
        expect(entries[0].content).toContain("Running tests");
        expect(entries[0].taskToolUseId).toBe("tool-abc");
        expect(entries[0].taskStatus).toBe("running");
        expect(entries[0].taskId).toBe("task-1");
      }
    });

    it("handles task_notification with usage info", () => {
      const msg = {
        type: "system",
        subtype: "task_notification",
        status: "completed",
        summary: "All tests passed",
        tool_use_id: "tool-abc",
        task_id: "task-1",
        usage: { duration_ms: 12300, tool_uses: 5 },
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      if (entries[0].kind === "system") {
        expect(entries[0].content).toContain("completed");
        expect(entries[0].content).toContain("All tests passed");
        expect(entries[0].content).toContain("12.3s");
        expect(entries[0].content).toContain("5 tools");
        expect(entries[0].taskSummary).toBe("All tests passed");
        expect(entries[0].taskUsage).toBe("12.3s, 5 tools");
      }
    });

    it("silently skips unknown system subtypes", () => {
      const msg = { type: "system", subtype: "status" };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toEqual([]);
    });
  });

  describe("tool_use_summary messages", () => {
    it("parses tool_use_summary into text entry", () => {
      const msg = {
        type: "tool_use_summary",
        summary: "Read 3 files",
      };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("text");
      if (entries[0].kind === "text") {
        expect(entries[0].content).toBe("Read 3 files");
      }
    });
  });

  describe("unknown message types", () => {
    it("returns empty for unhandled types", () => {
      const msg = { type: "some_unknown_type", data: "whatever" };
      const entries = parseStreamEvent(JSON.stringify(msg));
      expect(entries).toEqual([]);
    });
  });
});
