import { describe, expect, it } from "vitest";
import { buildPrChatTopic } from "@/lib/pr-chat-topic";
import type { PrThreadValidation } from "@/types/pull-request";

const thread = {
  repoPath: "github.com/acme/widgets",
  prUrl: "https://github.com/acme/widgets/pull/42",
  path: "src/cache.ts",
  line: 88,
  comments: [
    { author: "reviewer", url: "https://github.com/acme/widgets/pull/42#discussion_r1", body: "This early return skips the unlock." },
    { author: "sters", url: "https://github.com/acme/widgets/pull/42#discussion_r2", body: "Is it?" },
  ],
};

const validation: PrThreadValidation = {
  threadId: "PRRT_open",
  repoName: "widgets",
  commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1",
  verdict: "valid",
  interpretation: "The lock is not released on the error path.",
  reasoning: "cache.ts:88 returns before unlock().",
  recommendation: "Wrap the body in try/finally.",
  evidence: [],
  validatedAt: "2026-08-05T00:00:00.000Z",
};

describe("buildPrChatTopic", () => {
  it("locates a comment by its path in the workspace, so the chat can open the file", () => {
    const draft = buildPrChatTopic({ threads: [thread], checks: [] });
    expect(draft).toContain("github.com/acme/widgets/src/cache.ts, line 88");
    expect(draft).toContain("https://github.com/acme/widgets/pull/42#discussion_r1");
  });

  it("quotes every comment of the thread with its author, replies included", () => {
    const draft = buildPrChatTopic({ threads: [thread], checks: [] });
    expect(draft).toContain("reviewer:\nThis early return skips the unlock.");
    expect(draft).toContain("sters:\nIs it?");
  });

  it("falls back to the PR for a thread anchored to no line", () => {
    const draft = buildPrChatTopic({
      threads: [{ ...thread, path: null, line: null }],
      checks: [],
    });
    expect(draft).toContain("github.com/acme/widgets, on https://github.com/acme/widgets/pull/42");
  });

  it("cannot be closed early by a code fence inside a comment", () => {
    const body = "Try:\n```ts\nfinally { unlock(); }\n```";
    const draft = buildPrChatTopic({
      threads: [{ ...thread, comments: [{ author: "reviewer", url: "u", body }] }],
      checks: [],
    });
    expect(draft).toContain("````\nreviewer:\n" + body + "\n````");
  });

  it("carries a recorded verdict, so the chat starts from the analysis", () => {
    const draft = buildPrChatTopic({
      threads: [{ ...thread, validation }],
      checks: [],
    });
    expect(draft).toContain("The lock is not released on the error path.");
  });

  it("names a failing check with where its log is", () => {
    const draft = buildPrChatTopic({
      threads: [],
      checks: [
        {
          repoPath: "github.com/acme/widgets",
          prUrl: "https://github.com/acme/widgets/pull/42",
          name: "lint",
          url: "https://github.com/acme/widgets/actions/runs/1/job/2",
        },
      ],
    });
    expect(draft).toContain("Failing check `lint`");
    expect(draft).toContain("https://github.com/acme/widgets/actions/runs/1/job/2");
  });

  it("carries the note written on a comment or a check, after what it is about", () => {
    const draft = buildPrChatTopic({
      threads: [{ ...thread, note: "A or B? I lean A." }],
      checks: [{ repoPath: "github.com/acme/widgets", prUrl: "p", name: "lint", url: null, note: "Flaky?" }],
    });
    expect(draft).toMatch(/Is it\?\n`{3,}\nMy note: A or B\? I lean A\./);
    expect(draft).toContain("My note: Flaky?");
  });

  it("adds no note line when none was written", () => {
    expect(buildPrChatTopic({ threads: [{ ...thread, note: " " }], checks: [] })).not.toContain("My note:");
  });

  it("numbers comments and checks as one list", () => {
    const draft = buildPrChatTopic({
      threads: [thread],
      checks: [{ repoPath: "github.com/acme/widgets", prUrl: "p", name: "lint", url: null }],
    });
    expect(draft).toMatch(/^1\. /m);
    expect(draft).toMatch(/^2\. Failing check `lint`/m);
  });
});
