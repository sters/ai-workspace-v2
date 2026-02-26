import { describe, expect, it } from "vitest";
import { detectFatalApiError } from "@/lib/claude/cli";

describe("detectFatalApiError", () => {
  it("detects API Error: 401 in result errors", () => {
    const event = {
      type: "result",
      is_error: true,
      errors: ["API Error: 401 Unauthorized"],
    };
    expect(detectFatalApiError(event)).toBe("API Error: 401 Unauthorized");
  });

  it("detects API Error: 401 in result text", () => {
    const event = {
      type: "result",
      result: "API Error: 401",
    };
    expect(detectFatalApiError(event)).toBe("API Error: 401");
  });

  it("detects authentication_failed in assistant error field", () => {
    const event = {
      type: "assistant",
      error: "authentication_failed",
      message: { content: [] },
    };
    expect(detectFatalApiError(event)).toBe("authentication_failed");
  });

  it("detects auth_status error", () => {
    const event = {
      type: "auth_status",
      error: "authentication_failed",
    };
    expect(detectFatalApiError(event)).toBe("authentication_failed");
  });

  it("returns null for normal result events", () => {
    const event = {
      type: "result",
      subtype: "success",
      result: "Task completed successfully.",
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("returns null for normal assistant events", () => {
    const event = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("returns null for system events", () => {
    const event = {
      type: "system",
      subtype: "init",
      session_id: "abc",
    };
    expect(detectFatalApiError(event)).toBeNull();
  });

  it("detects 401 case-insensitively", () => {
    const event = {
      type: "result",
      is_error: true,
      errors: ["api error: 401"],
    };
    expect(detectFatalApiError(event)).toBe("api error: 401");
  });
});
