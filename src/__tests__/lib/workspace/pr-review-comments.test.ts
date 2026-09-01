import { describe, it, expect } from "vitest";
import {
  buildCommentBody,
  buildReviewPayload,
  extractPostedIds,
  findingMarker,
  parsePendingReviewId,
} from "@/lib/workspace/pr-review-comments";
import type { AnchoredReviewFinding } from "@/types/review-findings";

function finding(overrides: Partial<AnchoredReviewFinding>): AnchoredReviewFinding {
  return {
    id: "abc123abc123",
    repoName: "widgets",
    path: "src/a.ts",
    line: 11,
    startLine: null,
    side: "RIGHT",
    severity: "warning",
    confidence: "high",
    title: "Unhandled rejection",
    body: "`fetchUser` can reject and nothing catches it.",
    suggestion: null,
    anchor: "inline",
    anchorReason: null,
    posted: false,
    ...overrides,
  };
}

describe("findingMarker", () => {
  it("is an HTML comment, so it does not render in the posted comment", () => {
    expect(findingMarker("abc123")).toBe("<!-- aiw-finding:abc123 -->");
  });
});

describe("extractPostedIds", () => {
  it("reads the finding ids out of comments already on the PR", () => {
    const raw = JSON.stringify([
      { body: `Something.\n\n${findingMarker("aaa")}` },
      { body: `Other.\n\n${findingMarker("bbb")}` },
      { body: "A human's comment with no marker" },
    ]);
    expect(extractPostedIds(raw)).toEqual(new Set(["aaa", "bbb"]));
  });

  it("yields nothing for an unreadable or empty response", () => {
    expect(extractPostedIds("not json")).toEqual(new Set());
    expect(extractPostedIds("[]")).toEqual(new Set());
    expect(extractPostedIds(JSON.stringify({ message: "Not Found" }))).toEqual(new Set());
  });
});

describe("parsePendingReviewId", () => {
  // GitHub allows one pending review per user per PR, so a leftover one has to be
  // found before a post is attempted — it would be rejected otherwise.
  it("finds a pending review", () => {
    const raw = JSON.stringify([
      { id: 1, state: "APPROVED" },
      { id: 42, state: "PENDING" },
    ]);
    expect(parsePendingReviewId(raw)).toBe(42);
  });

  it("returns null when every review has been submitted", () => {
    const raw = JSON.stringify([{ id: 1, state: "COMMENTED" }]);
    expect(parsePendingReviewId(raw)).toBeNull();
  });

  it("returns null for an unreadable response", () => {
    expect(parsePendingReviewId("nope")).toBeNull();
  });
});

describe("buildCommentBody", () => {
  it("labels the finding and carries its marker", () => {
    const body = buildCommentBody(finding({}));
    expect(body).toContain("**Warning**");
    expect(body).toContain("`fetchUser` can reject");
    expect(body).toContain(findingMarker("abc123abc123"));
  });

  it("renders a suggestion as an applicable suggestion block", () => {
    const body = buildCommentBody(finding({ suggestion: "await fetchUser().catch(report)" }));
    expect(body).toContain("```suggestion\nawait fetchUser().catch(report)\n```");
  });

  // Confidence is the reviewer's read of whether the mechanism is real, and a
  // human on the PR is entitled to see it rather than a flat assertion.
  it("notes a non-high confidence", () => {
    expect(buildCommentBody(finding({ confidence: "low" }))).toMatch(/confidence: low/i);
    expect(buildCommentBody(finding({ confidence: "high" }))).not.toMatch(/confidence:/i);
  });

  // A file-level comment has lost the line, so the body has to say where it was
  // or the reader cannot find what is being talked about.
  it("names the line when the comment could not be anchored to it", () => {
    const body = buildCommentBody(
      finding({ anchor: "file", anchorReason: "line 50 of `src/a.ts` is not part of the diff" }),
    );
    expect(body).toContain("src/a.ts:11");
  });

  it("uses an edited body verbatim", () => {
    const body = buildCommentBody(finding({}), "I rewrote this myself.");
    expect(body).toContain("I rewrote this myself.");
    expect(body).not.toContain("fetchUser");
  });
});

describe("buildReviewPayload", () => {
  it("anchors an inline finding to its line on the post-change side", () => {
    const { payload, results } = buildReviewPayload({
      findings: [finding({})],
      commitSha: "deadbeef",
      submit: false,
    });
    expect(payload.commit_id).toBe("deadbeef");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]).toMatchObject({ path: "src/a.ts", line: 11, side: "RIGHT" });
    expect(results).toEqual([{ id: "abc123abc123", status: "posted" }]);
  });

  it("sends both ends of a multi-line finding", () => {
    const { payload } = buildReviewPayload({
      findings: [finding({ startLine: 9 })],
      commitSha: "sha",
      submit: false,
    });
    expect(payload.comments[0]).toMatchObject({
      start_line: 9,
      start_side: "RIGHT",
      line: 11,
    });
  });

  it("sends a file-level finding without a line", () => {
    const { payload } = buildReviewPayload({
      findings: [finding({ anchor: "file" })],
      commitSha: "sha",
      submit: false,
    });
    expect(payload.comments[0]).toMatchObject({ path: "src/a.ts", subject_type: "file" });
    expect(payload.comments[0]).not.toHaveProperty("line");
  });

  // The file is not in the diff, so GitHub would reject a comment on it at any
  // level. The review body is the one place it still reaches the reader.
  it("moves a pr-body finding into the review body", () => {
    const { payload, results } = buildReviewPayload({
      findings: [finding({ anchor: "pr-body", path: "src/untouched.ts" })],
      commitSha: "sha",
      submit: false,
    });
    expect(payload.comments).toHaveLength(0);
    expect(payload.body).toContain("src/untouched.ts");
    expect(results[0].status).toBe("posted");
  });

  it("skips a finding already on the PR instead of posting it twice", () => {
    const { payload, results } = buildReviewPayload({
      findings: [finding({ posted: true })],
      commitSha: "sha",
      submit: false,
    });
    expect(payload.comments).toHaveLength(0);
    expect(results[0]).toMatchObject({ id: "abc123abc123", status: "skipped" });
    expect(results[0].reason).toMatch(/already/i);
  });

  it("uses the body the human edited", () => {
    const { payload } = buildReviewPayload({
      findings: [finding({})],
      commitSha: "sha",
      submit: false,
      bodies: { abc123abc123: "edited text" },
    });
    expect(payload.comments[0].body).toContain("edited text");
  });

  // Omitting `event` is what leaves the review pending for a human to submit.
  it("leaves the review pending by default and submits only when asked", () => {
    const pending = buildReviewPayload({ findings: [finding({})], commitSha: "s", submit: false });
    expect(pending.payload.event).toBeUndefined();

    const submitted = buildReviewPayload({
      findings: [finding({})],
      commitSha: "s",
      submit: true,
    });
    expect(submitted.payload.event).toBe("COMMENT");
  });

  it("reports a result for every finding it was given", () => {
    const { results } = buildReviewPayload({
      findings: [
        finding({ id: "one" }),
        finding({ id: "two", posted: true }),
        finding({ id: "three", anchor: "pr-body" }),
      ],
      commitSha: "sha",
      submit: false,
    });
    expect(results.map((r) => r.id)).toEqual(["one", "two", "three"]);
  });

  it("has nothing to send when every finding was already posted", () => {
    const { hasContent } = buildReviewPayload({
      findings: [finding({ posted: true })],
      commitSha: "sha",
      submit: false,
    });
    expect(hasContent).toBe(false);
  });
});
