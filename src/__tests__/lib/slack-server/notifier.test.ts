import { describe, expect, it } from "vitest";
import {
  extractPrUrlsFromEvents,
  buildCompletionMessage,
} from "@/lib/slack-server/notifier";
import type { OperationEvent } from "@/types/operation";

function ev(data: string): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    data,
    timestamp: "2026-05-13T00:00:00.000Z",
  };
}

describe("extractPrUrlsFromEvents", () => {
  it("returns empty when no events contain a PR URL", () => {
    expect(extractPrUrlsFromEvents([])).toEqual([]);
    expect(extractPrUrlsFromEvents([ev("plain text"), ev("more text")])).toEqual([]);
  });

  it("finds a single PR URL in event data", () => {
    const out = extractPrUrlsFromEvents([
      ev('{"text":"opened https://github.com/acme/foo/pull/12"}'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://github.com/acme/foo/pull/12");
    expect(out[0].owner).toBe("acme");
    expect(out[0].repo).toBe("foo");
    expect(out[0].prNumber).toBe(12);
  });

  it("deduplicates the same URL across events", () => {
    const out = extractPrUrlsFromEvents([
      ev("https://github.com/acme/foo/pull/1"),
      ev("https://github.com/acme/foo/pull/1 again"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("collects multiple distinct PRs across events", () => {
    const out = extractPrUrlsFromEvents([
      ev("created https://github.com/acme/foo/pull/1"),
      ev("and https://github.com/acme/bar/pull/9"),
    ]);
    expect(out.map((p) => p.url).sort()).toEqual([
      "https://github.com/acme/bar/pull/9",
      "https://github.com/acme/foo/pull/1",
    ]);
  });
});

describe("buildCompletionMessage", () => {
  it("formats a list when PRs are present", () => {
    const msg = buildCompletionMessage([
      { url: "https://github.com/a/b/pull/1", owner: "a", repo: "b", repoPath: "github.com/a/b", prNumber: 1 },
      { url: "https://github.com/a/c/pull/2", owner: "a", repo: "c", repoPath: "github.com/a/c", prNumber: 2 },
    ]);
    expect(msg).toBe(
      "Done! Created PRs:\n• https://github.com/a/b/pull/1\n• https://github.com/a/c/pull/2",
    );
  });

  it("falls back to no-PRs message when empty", () => {
    expect(buildCompletionMessage([])).toBe(
      "Done! No PRs were created. Please check details on WebUI.",
    );
  });
});
