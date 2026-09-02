import { describe, it, expect } from "vitest";
import {
  mergeGroundings,
  normalizeHolds,
  normalizeScope,
  parseGroundingStore,
  shouldPost,
} from "@/lib/workspace/finding-groundings";
import type { FindingGrounding } from "@/types/review-findings";

function grounding(overrides: Partial<FindingGrounding> = {}): FindingGrounding {
  return {
    findingId: "abc123",
    repoName: "widgets",
    holds: "yes",
    scope: "pr",
    evidence: ["src/a.ts:42"],
    comment: "This rejects and nothing catches it.",
    reason: "confirmed at src/a.ts:42",
    posted: true,
    groundedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeHolds", () => {
  it("reads the three verdicts", () => {
    expect(normalizeHolds("yes")).toBe("yes");
    expect(normalizeHolds("no")).toBe("no");
    expect(normalizeHolds("unclear")).toBe("unclear");
  });

  // Not `yes`: an unparsed verdict must never be the one that puts a comment on
  // someone else's PR.
  it("falls back to unclear for anything it does not recognise", () => {
    expect(normalizeHolds("probably")).toBe("unclear");
    expect(normalizeHolds(undefined)).toBe("unclear");
    expect(normalizeHolds("")).toBe("unclear");
  });
});

describe("normalizeScope", () => {
  it("reads the three scopes", () => {
    expect(normalizeScope("pr")).toBe("pr");
    expect(normalizeScope("local-only")).toBe("local-only");
    expect(normalizeScope("pre-existing")).toBe("pre-existing");
  });

  // Same direction as the verdict: the fallback is the one that does not post.
  it("falls back to pre-existing for anything unrecognised", () => {
    expect(normalizeScope("whatever")).toBe("pre-existing");
    expect(normalizeScope(undefined)).toBe("pre-existing");
  });
});

describe("shouldPost", () => {
  it("posts a confirmed finding caused by this PR", () => {
    expect(shouldPost(grounding())).toBe(true);
  });

  it("does not post a claim the code refuted", () => {
    expect(shouldPost(grounding({ holds: "no" }))).toBe(false);
  });

  // The whole point of the grounding pass: a finding that only reproduces from
  // local state is not on the branch anyone else can see.
  it("does not post a local-only problem", () => {
    expect(shouldPost(grounding({ scope: "local-only" }))).toBe(false);
  });

  it("does not post a defect that predates the branch", () => {
    expect(shouldPost(grounding({ scope: "pre-existing" }))).toBe(false);
  });

  it("does not post what the code could not settle", () => {
    expect(shouldPost(grounding({ holds: "unclear" }))).toBe(false);
  });

  // A verdict that cleared every bar but produced no text has nothing to post,
  // and an empty comment body would read as a mistake on the PR.
  it("does not post an empty comment", () => {
    expect(shouldPost(grounding({ comment: "   " }))).toBe(false);
  });
});

describe("parseGroundingStore", () => {
  it("reads stored groundings", () => {
    const raw = JSON.stringify({
      version: 1,
      groundings: { abc123: grounding() },
    });
    expect(parseGroundingStore(raw).groundings.abc123).toMatchObject({
      findingId: "abc123",
      holds: "yes",
      scope: "pr",
      posted: true,
    });
  });

  // A key that disagrees with the stored id would show one finding's verdict
  // under another's row.
  it("drops an entry whose key disagrees with its id", () => {
    const raw = JSON.stringify({
      version: 1,
      groundings: { other: grounding({ findingId: "abc123" }) },
    });
    expect(parseGroundingStore(raw).groundings).toEqual({});
  });

  it("yields an empty store for unreadable content", () => {
    expect(parseGroundingStore("not json").groundings).toEqual({});
    expect(parseGroundingStore(JSON.stringify({ groundings: 7 })).groundings).toEqual({});
  });
});

describe("mergeGroundings", () => {
  it("replaces an earlier verdict with the newer read of the code", () => {
    const store = { version: 1 as const, groundings: { abc123: grounding({ holds: "no" }) } };
    const merged = mergeGroundings(store, [grounding({ holds: "yes" })]);
    expect(merged.groundings.abc123.holds).toBe("yes");
  });

  it("leaves findings the run was not asked about alone", () => {
    const store = { version: 1 as const, groundings: { other: grounding({ findingId: "other" }) } };
    const merged = mergeGroundings(store, [grounding()]);
    expect(Object.keys(merged.groundings).sort()).toEqual(["abc123", "other"]);
  });

  it("starts from nothing when there is no store yet", () => {
    expect(Object.keys(mergeGroundings(undefined, [grounding()]).groundings)).toEqual(["abc123"]);
  });
});
