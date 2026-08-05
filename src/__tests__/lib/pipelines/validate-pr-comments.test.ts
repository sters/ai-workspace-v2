import { describe, it, expect } from "vitest";
import {
  parseValidationResult,
  validatePrCommentsBudgetMs,
} from "@/lib/pipelines/validate-pr-comments";
import type { PrReviewThread } from "@/types/pull-request";

const thread: PrReviewThread = {
  id: "PRRT_a",
  isResolved: false,
  isOutdated: false,
  path: "src/cache.ts",
  line: 88,
  comments: [
    {
      url: "https://github.com/acme/widgets/pull/42#discussion_r1",
      author: "reviewer",
      body: "This early return skips the unlock.",
      createdAt: "2026-08-04T10:00:00Z",
    },
  ],
};

const context = { thread, repoName: "widgets", validatedAt: "2026-08-05T00:00:00.000Z" };

describe("validatePrCommentsBudgetMs", () => {
  it("scales with the number of selected threads", () => {
    // The concurrency cap means a large selection queues, so a flat budget would
    // kill the tail and re-run the whole fan-out on the same allowance.
    expect(validatePrCommentsBudgetMs(10)).toBeGreaterThan(validatePrCommentsBudgetMs(1));
  });

  it("gives an empty selection a usable budget rather than zero", () => {
    expect(validatePrCommentsBudgetMs(0)).toBeGreaterThan(0);
  });
});

describe("parseValidationResult", () => {
  it("maps the child's structured output onto the stored shape", () => {
    const raw = JSON.stringify({
      verdict: "valid",
      interpretation: "The lock is not released on the error path.",
      reasoning: "cache.ts:88 returns before unlock().",
      recommendation: "Wrap the body in try/finally.",
      evidence: ["src/cache.ts:88", 42],
    });

    expect(parseValidationResult(raw, context)).toEqual({
      threadId: "PRRT_a",
      repoName: "widgets",
      commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1",
      verdict: "valid",
      interpretation: "The lock is not released on the error path.",
      reasoning: "cache.ts:88 returns before unlock().",
      recommendation: "Wrap the body in try/finally.",
      evidence: ["src/cache.ts:88"],
      validatedAt: "2026-08-05T00:00:00.000Z",
    });
  });

  it("coerces an off-enum verdict to unclear", () => {
    const raw = JSON.stringify({ verdict: "probably", interpretation: "x" });
    expect(parseValidationResult(raw, context)?.verdict).toBe("unclear");
  });

  it("returns null for output with no verdict at all", () => {
    // Storing that as `unclear` would render in the tab as a considered answer
    // meaning "the code cannot settle this" — a different claim from "the child
    // returned nothing".
    expect(parseValidationResult(JSON.stringify({ interpretation: "x" }), context)).toBeNull();
    expect(parseValidationResult("", context)).toBeNull();
    expect(parseValidationResult("   ", context)).toBeNull();
    expect(parseValidationResult("{oops", context)).toBeNull();
    expect(parseValidationResult("null", context)).toBeNull();
  });

  it("survives a thread with no comments", () => {
    const raw = JSON.stringify({ verdict: "unclear" });
    const parsed = parseValidationResult(raw, { ...context, thread: { ...thread, comments: [] } });
    expect(parsed?.commentUrl).toBe("");
  });

  it("tolerates missing prose fields without dropping the verdict", () => {
    const parsed = parseValidationResult(JSON.stringify({ verdict: "invalid" }), context);
    expect(parsed).toMatchObject({ verdict: "invalid", interpretation: "", evidence: [] });
  });
});
