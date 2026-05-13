import { describe, expect, it } from "vitest";
import { formatThreadContext, mergeIntoDescription } from "@/lib/slack-server/thread-context";

describe("formatThreadContext", () => {
  it("formats a sequence of user messages", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "We need to fix the login bug", ts: "1.0" },
        { user: "U2", text: "Yeah, the timeout is too short", ts: "2.0" },
      ],
      { excludeTs: "999.0" },
    );
    expect(out).toBe("<@U1>: We need to fix the login bug\n<@U2>: Yeah, the timeout is too short");
  });

  it("excludes the message with excludeTs", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "first message", ts: "1.0" },
        { user: "U2", text: "@bot init please", ts: "2.0" },
      ],
      { excludeTs: "2.0" },
    );
    expect(out).toBe("<@U1>: first message");
  });

  it("includes bot/app messages from OTHER bots", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "real user message", ts: "1.0" },
        { user: "U_OTHER_BOT", text: "CI passed", ts: "2.0", bot_id: "B_OTHER" },
      ],
      { excludeTs: "999.0", ourBotUserId: "U_OUR_BOT", ourBotId: "B_OURS" },
    );
    expect(out).toBe("<@U1>: real user message\n<@U_OTHER_BOT>: CI passed");
  });

  it("excludes our own bot's prior replies (matched by user_id)", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "real user message", ts: "1.0" },
        { user: "U_OUR_BOT", text: "OK! I'll proceed this soon!", ts: "2.0", bot_id: "B_OURS" },
      ],
      { excludeTs: "999.0", ourBotUserId: "U_OUR_BOT", ourBotId: "B_OURS" },
    );
    expect(out).toBe("<@U1>: real user message");
  });

  it("excludes our own bot's prior replies (matched by bot_id when user is missing)", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "real user message", ts: "1.0" },
        { text: "OK!", ts: "2.0", bot_id: "B_OURS" },
      ],
      { excludeTs: "999.0", ourBotUserId: "U_OUR_BOT", ourBotId: "B_OURS" },
    );
    expect(out).toBe("<@U1>: real user message");
  });

  it("formats bot_profile.name when user is absent", () => {
    const out = formatThreadContext(
      [
        { text: "PR opened: ...", ts: "1.0", bot_id: "B_GH", bot_profile: { name: "GitHub" } },
      ],
      { excludeTs: "999.0" },
    );
    expect(out).toBe("GitHub: PR opened: ...");
  });

  it("falls back to username when neither user nor bot_profile present", () => {
    const out = formatThreadContext(
      [{ text: "alert!", ts: "1.0", bot_id: "B_X", username: "Alertmanager" }],
      { excludeTs: "999.0" },
    );
    expect(out).toBe("Alertmanager: alert!");
  });

  it("excludes messages without text", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "real", ts: "1.0" },
        { user: "U2", text: "", ts: "2.0" },
        { user: "U3", text: undefined, ts: "3.0" },
      ],
      { excludeTs: "999.0" },
    );
    expect(out).toBe("<@U1>: real");
  });

  it("returns empty string when nothing remains after filtering", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "@bot init", ts: "1.0" },
        { user: "U_OUR_BOT", text: "OK!", ts: "2.0", bot_id: "B_OURS" },
      ],
      { excludeTs: "1.0", ourBotUserId: "U_OUR_BOT", ourBotId: "B_OURS" },
    );
    expect(out).toBe("");
  });

  it("handles missing user (e.g. system messages)", () => {
    const out = formatThreadContext(
      [{ user: undefined, text: "system msg", ts: "1.0" }],
      { excludeTs: "999.0" },
    );
    expect(out).toBe("system msg");
  });

  it("preserves message order", () => {
    const out = formatThreadContext(
      [
        { user: "U1", text: "one", ts: "1.0" },
        { user: "U1", text: "two", ts: "2.0" },
        { user: "U1", text: "three", ts: "3.0" },
      ],
      { excludeTs: "x" },
    );
    expect(out).toBe("<@U1>: one\n<@U1>: two\n<@U1>: three");
  });
});

describe("mergeIntoDescription", () => {
  it("returns thread context only when description is empty", () => {
    expect(mergeIntoDescription("", "ctx body")).toBe("ctx body");
  });

  it("returns description only when thread is empty", () => {
    expect(mergeIntoDescription("desc", "")).toBe("desc");
  });

  it("appends thread under a separator when both present", () => {
    expect(mergeIntoDescription("the request", "thread body")).toBe(
      "the request\n\n--- Slack thread context ---\nthread body",
    );
  });

  it("returns empty string when both empty", () => {
    expect(mergeIntoDescription("", "")).toBe("");
  });
});
