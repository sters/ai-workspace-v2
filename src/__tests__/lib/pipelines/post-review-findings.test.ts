import { describe, it, expect } from "vitest";
import {
  parseGroundingResult,
  postReviewFindingsBudgetMs,
  knownFindingsFromGroundings,
  summarizeGroundings,
} from "@/lib/pipelines/post-review-findings";
import type { FindingGrounding } from "@/types/review-findings";

const CONTEXT = {
  findingId: "abc123",
  repoName: "widgets",
  groundedAt: "2026-09-01T00:00:00.000Z",
};

function grounding(overrides: Partial<FindingGrounding> = {}): FindingGrounding {
  return {
    findingId: "abc123",
    repoName: "widgets",
    holds: "yes",
    scope: "pr",
    evidence: [],
    comment: "text",
    reason: "",
    posted: false,
    groundedAt: CONTEXT.groundedAt,
    ...overrides,
  };
}

describe("parseGroundingResult", () => {
  it("reads a verdict that earns a comment", () => {
    const raw = JSON.stringify({
      holds: "yes",
      scope: "pr",
      comment: "この reject は捕捉されていません。",
      reason: "confirmed at src/a.ts:42",
      evidence: ["src/a.ts:42"],
    });
    expect(parseGroundingResult(raw, CONTEXT)).toMatchObject({
      findingId: "abc123",
      repoName: "widgets",
      holds: "yes",
      scope: "pr",
      comment: "この reject は捕捉されていません。",
      evidence: ["src/a.ts:42"],
      posted: false,
    });
  });

  it("reads a refusal with its reason", () => {
    const raw = JSON.stringify({
      holds: "no",
      scope: "pr",
      comment: "",
      reason: "handled by the caller at src/b.ts:10",
    });
    expect(parseGroundingResult(raw, CONTEXT)).toMatchObject({
      holds: "no",
      reason: "handled by the caller at src/b.ts:10",
    });
  });

  // A child that died or returned prose is not a verdict. Recording it as
  // `unclear` would look like a considered answer; a null leaves the finding
  // untouched and re-runnable.
  it("returns null for output with no verdict in it", () => {
    expect(parseGroundingResult("", CONTEXT)).toBeNull();
    expect(parseGroundingResult("I could not determine this", CONTEXT)).toBeNull();
    expect(parseGroundingResult(JSON.stringify({ scope: "pr" }), CONTEXT)).toBeNull();
  });

  // Unknown values must not become the ones that post.
  it("coerces an unrecognised verdict or scope to a non-posting value", () => {
    const raw = JSON.stringify({ holds: "maybe", scope: "everywhere", comment: "x", reason: "" });
    expect(parseGroundingResult(raw, CONTEXT)).toMatchObject({
      holds: "unclear",
      scope: "pre-existing",
    });
  });
});

describe("summarizeGroundings", () => {
  it("counts what went out and what did not", () => {
    const summary = summarizeGroundings([
      grounding({ findingId: "a", posted: true }),
      grounding({ findingId: "b", holds: "no", comment: "", reason: "misreads the code" }),
      grounding({ findingId: "c", scope: "local-only", comment: "", reason: "uncommitted" }),
      grounding({ findingId: "d", holds: "unclear", comment: "", reason: "needs product input" }),
    ]);
    expect(summary).toContain("1 posted");
    expect(summary).toContain("1 refuted");
    expect(summary).toContain("1 local-only");
    expect(summary).toContain("1 unclear");
  });

  it("says so plainly when nothing was posted", () => {
    const summary = summarizeGroundings([grounding({ holds: "no", comment: "" })]);
    expect(summary).toMatch(/no comment/i);
  });
});

describe("postReviewFindingsBudgetMs", () => {
  // Per finding, not flat: the children run concurrently but the concurrency cap
  // makes a large selection queue, and a budget sized for one would kill the tail
  // and re-run all of it.
  it("grows with the selection", () => {
    expect(postReviewFindingsBudgetMs(10)).toBeGreaterThan(postReviewFindingsBudgetMs(1));
  });

  it("budgets at least one finding for an empty selection", () => {
    expect(postReviewFindingsBudgetMs(0)).toBe(postReviewFindingsBudgetMs(1));
  });
});

describe("knownFindingsFromGroundings", () => {
  function entry(overrides: Partial<FindingGrounding>, title = "Null deref on payload") {
    return { grounding: grounding(overrides), title };
  }

  it("records a refuted claim as low-confidence", () => {
    const [finding] = knownFindingsFromGroundings([
      entry({ holds: "no", reason: "the guard is on line 12" }),
    ]);
    expect(finding.kind).toBe("low-confidence");
    expect(finding.summary).toBe("Null deref on payload");
    expect(finding.reason).toContain("refuted: the guard is on line 12");
  });

  it("records an unsettled claim as low-confidence", () => {
    const [finding] = knownFindingsFromGroundings([entry({ holds: "unclear" })]);
    expect(finding.kind).toBe("low-confidence");
    expect(finding.reason).toContain("could not settle");
  });

  it("records a confirmed pre-existing defect as pre-existing", () => {
    const [finding] = knownFindingsFromGroundings([
      entry({ holds: "yes", scope: "pre-existing", reason: "present before the branch" }),
    ]);
    expect(finding.kind).toBe("pre-existing");
    expect(finding.reason).toContain("not introduced by this branch");
  });

  it("distinguishes a local-only artifact in its reason", () => {
    const [finding] = knownFindingsFromGroundings([
      entry({ holds: "yes", scope: "local-only" }),
    ]);
    expect(finding.kind).toBe("pre-existing");
    expect(finding.reason).toContain("only from local state");
  });

  it("never ledgers a finding that earned a comment, even when the post failed", () => {
    // `posted: false` here is GitHub's outcome, not the grounder's verdict. The
    // ask still stands, and listing it would tell the next review to compress it.
    expect(
      knownFindingsFromGroundings([
        entry({ holds: "yes", scope: "pr", comment: "please add the guard", posted: false }),
      ]),
    ).toEqual([]);
  });

  it("skips a confirmed finding the grounder wrote no comment for", () => {
    expect(
      knownFindingsFromGroundings([entry({ holds: "yes", scope: "pr", comment: "" })]),
    ).toEqual([]);
  });

  it("skips an entry whose title could not be resolved", () => {
    expect(knownFindingsFromGroundings([entry({ holds: "no" }, "  ")])).toEqual([]);
  });
});
