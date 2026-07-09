import { describe, expect, it, vi } from "vitest";
import { formatThreadMessages, fetchThreadTranscript } from "@/lib/slack-server/thread-fetch";

describe("formatThreadMessages", () => {
  it("renders user + text per line", () => {
    const out = formatThreadMessages([
      { user: "U1", text: "hello", ts: "1" },
      { user: "U2", text: "world", ts: "2" },
    ]);
    expect(out).toBe("@U1: hello\n@U2: world");
  });

  it("excludes the message with the given ts", () => {
    const out = formatThreadMessages(
      [
        { user: "U1", text: "keep me", ts: "1" },
        { user: "U2", text: "drop me", ts: "2" },
      ],
      "2",
    );
    expect(out).toBe("@U1: keep me");
  });

  it("skips empty / whitespace-only messages", () => {
    const out = formatThreadMessages([
      { user: "U1", text: "  ", ts: "1" },
      { user: "U2", text: "real", ts: "2" },
      { user: "U3", ts: "3" },
    ]);
    expect(out).toBe("@U2: real");
  });

  it("labels bot messages without a user", () => {
    const out = formatThreadMessages([{ bot_id: "B1", text: "beep", ts: "1" }]);
    expect(out).toBe("bot: beep");
  });
});

describe("fetchThreadTranscript", () => {
  it("returns a formatted transcript from a single page", async () => {
    const replies = vi.fn().mockResolvedValue({
      messages: [
        { user: "U1", text: "a", ts: "1" },
        { user: "U2", text: "b", ts: "2" },
      ],
      has_more: false,
    });
    const client = { conversations: { replies } };

    const out = await fetchThreadTranscript(client as never, "C1", "1", "2");
    expect(out).toBe("@U1: a");
    expect(replies).toHaveBeenCalledTimes(1);
    expect(replies).toHaveBeenCalledWith({ channel: "C1", ts: "1", limit: 200, cursor: undefined });
  });

  it("follows pagination via next_cursor", async () => {
    const replies = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ user: "U1", text: "a", ts: "1" }],
        has_more: true,
        response_metadata: { next_cursor: "CUR" },
      })
      .mockResolvedValueOnce({
        messages: [{ user: "U2", text: "b", ts: "2" }],
        has_more: false,
      });
    const client = { conversations: { replies } };

    const out = await fetchThreadTranscript(client as never, "C1", "1");
    expect(out).toBe("@U1: a\n@U2: b");
    expect(replies).toHaveBeenCalledTimes(2);
    expect(replies).toHaveBeenLastCalledWith({ channel: "C1", ts: "1", limit: 200, cursor: "CUR" });
  });

  it("returns empty string when the fetch throws (e.g. missing scope)", async () => {
    const replies = vi.fn().mockRejectedValue(new Error("missing_scope"));
    const client = { conversations: { replies } };

    const out = await fetchThreadTranscript(client as never, "C1", "1");
    expect(out).toBe("");
  });
});
