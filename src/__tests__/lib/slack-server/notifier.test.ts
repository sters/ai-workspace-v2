import { describe, expect, it } from "vitest";
import {
  extractCreatedPrs,
  buildCompletionMessage,
} from "@/lib/slack-server/notifier";
import type { OperationEvent } from "@/types/operation";

function ev(data: string, phaseLabel?: string): OperationEvent {
  return {
    type: "output",
    operationId: "op-1",
    data,
    timestamp: "2026-05-13T00:00:00.000Z",
    ...(phaseLabel && { phaseLabel }),
  };
}

describe("extractCreatedPrs", () => {
  it("returns empty when there are no events", () => {
    expect(extractCreatedPrs([])).toEqual([]);
  });

  it("finds PR URLs only in events whose phaseLabel is 'Create PR'", () => {
    const out = extractCreatedPrs([
      ev("read https://github.com/acme/foo/pull/9 from a comment", "Analyze & draft README"),
      ev("ran code-review on https://github.com/acme/foo/pull/9", "Code Review"),
      ev('{"text":"created PR https://github.com/acme/foo/pull/12"}', "Create PR"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://github.com/acme/foo/pull/12");
  });

  it("ignores URLs from non-Create-PR phases even if they look like real PRs", () => {
    const out = extractCreatedPrs([
      ev("https://github.com/acme/foo/pull/1", "Execute"),
      ev("https://github.com/acme/foo/pull/2", "Review"),
    ]);
    expect(out).toEqual([]);
  });

  it("ignores events with no phaseLabel", () => {
    const out = extractCreatedPrs([ev("https://github.com/acme/foo/pull/1")]);
    expect(out).toEqual([]);
  });

  it("excludes URLs that were already in the input description", () => {
    const out = extractCreatedPrs(
      [ev("created https://github.com/acme/foo/pull/12", "Create PR")],
      { inputDescription: "please base on https://github.com/acme/foo/pull/12 and extend" },
    );
    expect(out).toEqual([]);
  });

  it("keeps Create-PR URLs that were NOT in the description", () => {
    const out = extractCreatedPrs(
      [
        ev("https://github.com/acme/foo/pull/12", "Create PR"),
        ev("https://github.com/acme/bar/pull/3", "Create PR"),
      ],
      { inputDescription: "based on https://github.com/acme/foo/pull/12" },
    );
    expect(out.map((p) => p.url)).toEqual(["https://github.com/acme/bar/pull/3"]);
  });

  it("deduplicates a URL appearing in multiple Create PR events", () => {
    const out = extractCreatedPrs([
      ev("https://github.com/acme/foo/pull/1", "Create PR"),
      ev("https://github.com/acme/foo/pull/1 (linked again)", "Create PR"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("collects URLs across multiple Create PR child events (different repos)", () => {
    const out = extractCreatedPrs([
      ev("https://github.com/acme/foo/pull/1", "Create PR"),
      ev("https://github.com/acme/bar/pull/9", "Create PR"),
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
