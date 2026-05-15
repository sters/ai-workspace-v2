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

  describe("attachments (link unfurls)", () => {
    it("includes service_name, title, title_link, and text from an unfurl", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "check this",
            ts: "1.0",
            attachments: [
              {
                service_name: "GitHub",
                title: "Fix login bug",
                title_link: "https://github.com/org/repo/pull/123",
                text: "This PR fixes the login bug.",
              },
            ],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe(
        "<@U1>: check this\n" +
          "  > [GitHub] Fix login bug (https://github.com/org/repo/pull/123)\n" +
          "  > This PR fixes the login bug.",
      );
    });

    it("includes author_name and text for a Slack message unfurl (no title)", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "このスレッド見て",
            ts: "1.0",
            attachments: [
              {
                author_name: "Alice",
                text: "Original message body in the linked thread.",
                from_url: "https://example.slack.com/archives/C1/p123",
              },
            ],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe(
        "<@U1>: このスレッド見て\n" +
          "  > Alice\n" +
          "  > https://example.slack.com/archives/C1/p123\n" +
          "  > Original message body in the linked thread.",
      );
    });

    it("renders attachment fields as key: value lines", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "x",
            ts: "1.0",
            attachments: [
              {
                title: "T",
                fields: [
                  { title: "Status", value: "Open" },
                  { title: "Assignee", value: "bob" },
                ],
              },
            ],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe(
        "<@U1>: x\n  > T\n  > Status: Open\n  > Assignee: bob",
      );
    });

    it("uses fallback only when no other text fields are present", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "x",
            ts: "1.0",
            attachments: [{ fallback: "plain text version" }],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe("<@U1>: x\n  > plain text version");
    });

    it("ignores fallback when title/text are present (avoids duplicates)", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "x",
            ts: "1.0",
            attachments: [
              { title: "T", text: "body", fallback: "T - body" },
            ],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe("<@U1>: x\n  > T\n  > body");
    });

    it("includes a message that has only attachments (no text)", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            ts: "1.0",
            attachments: [{ title: "PR opened", text: "details" }],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe("<@U1>:\n  > PR opened\n  > details");
    });

    it("handles multiple attachments", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "two links",
            ts: "1.0",
            attachments: [
              { title: "A", title_link: "https://a" },
              { title: "B", title_link: "https://b" },
            ],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe(
        "<@U1>: two links\n  > A (https://a)\n  > B (https://b)",
      );
    });

    it("skips attachments that contain no extractable text", () => {
      const out = formatThreadContext(
        [
          {
            user: "U1",
            text: "x",
            ts: "1.0",
            attachments: [{}, { title: "  " }],
          },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe("<@U1>: x");
    });

    it("drops messages that have neither text nor extractable attachments", () => {
      const out = formatThreadContext(
        [
          { user: "U1", text: "kept", ts: "1.0" },
          { user: "U2", ts: "2.0", attachments: [{}] },
        ],
        { excludeTs: "999.0" },
      );
      expect(out).toBe("<@U1>: kept");
    });
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
