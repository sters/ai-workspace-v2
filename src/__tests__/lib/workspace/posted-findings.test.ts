import { describe, it, expect } from "vitest";
import { buildPostedAsks, formatPostedAsk } from "@/lib/workspace/posted-findings";
import type { FindingGrounding, ReviewFinding } from "@/types/review-findings";

function grounding(overrides: Partial<FindingGrounding> = {}): FindingGrounding {
  return {
    findingId: "abc123",
    repoName: "svc",
    holds: "yes",
    scope: "pr",
    evidence: [],
    comment: "This handler dereferences `payload` before the null check.",
    reason: "confirmed in code",
    posted: true,
    groundedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "abc123",
    repoName: "svc",
    path: "src/api/handler.ts",
    line: 42,
    startLine: null,
    side: "RIGHT",
    severity: "warning",
    confidence: "high",
    title: "Null dereference on payload",
    body: "…",
    suggestion: null,
    ...overrides,
  };
}

describe("formatPostedAsk", () => {
  it("names the location and quotes the comment the author saw", () => {
    const text = formatPostedAsk({ grounding: grounding(), finding: finding() });

    expect(text).toContain("src/api/handler.ts:42 — Null dereference on payload");
    expect(text).toContain("on 2026-09-01");
    expect(text).toContain("> This handler dereferences `payload` before the null check.");
  });

  it("says (file) for a finding with no line", () => {
    const text = formatPostedAsk({ grounding: grounding(), finding: finding({ line: null }) });
    expect(text).toContain("src/api/handler.ts:(file)");
  });

  it("still produces an ask when the finding's review session is gone", () => {
    const text = formatPostedAsk({ grounding: grounding(), finding: undefined });

    expect(text).toContain("no longer on disk");
    // The comment is the ask; losing the session must not lose the request.
    expect(text).toContain("> This handler dereferences");
  });

  it("truncates a very long comment", () => {
    const text = formatPostedAsk({
      grounding: grounding({ comment: "x".repeat(2000) }),
      finding: finding(),
    });
    expect(text.length).toBeLessThan(1200);
    expect(text).toContain("…");
  });

  it("falls back to the finding body when no comment was recorded", () => {
    const text = formatPostedAsk({
      grounding: grounding({ comment: "" }),
      finding: finding({ body: "the reviewer's own wording" }),
    });
    expect(text).toContain("> the reviewer's own wording");
  });
});

describe("buildPostedAsks", () => {
  it("keeps only posted groundings", () => {
    const asks = buildPostedAsks(
      {
        a: grounding({ findingId: "a", posted: true }),
        b: grounding({ findingId: "b", posted: false }),
      },
      new Map([
        ["a", finding({ id: "a", path: "a.ts" })],
        ["b", finding({ id: "b", path: "b.ts" })],
      ]),
    );

    expect(asks.get("svc")).toHaveLength(1);
    expect(asks.get("svc")?.[0]).toContain("a.ts");
  });

  it("groups by repository so no verifier is handed another repo's comment", () => {
    const asks = buildPostedAsks(
      {
        a: grounding({ findingId: "a", repoName: "svc" }),
        b: grounding({ findingId: "b", repoName: "web" }),
      },
      new Map([
        ["a", finding({ id: "a", repoName: "svc" })],
        ["b", finding({ id: "b", repoName: "web", path: "app/page.tsx" })],
      ]),
    );

    expect([...asks.keys()].sort()).toEqual(["svc", "web"]);
    expect(asks.get("web")?.[0]).toContain("app/page.tsx");
  });

  it("orders asks by path then line, so the verifier's numbering is stable", () => {
    const asks = buildPostedAsks(
      {
        a: grounding({ findingId: "a" }),
        b: grounding({ findingId: "b" }),
        c: grounding({ findingId: "c" }),
      },
      new Map([
        ["a", finding({ id: "a", path: "b.ts", line: 1 })],
        ["b", finding({ id: "b", path: "a.ts", line: 90 })],
        ["c", finding({ id: "c", path: "a.ts", line: 5 })],
      ]),
    );

    const order = asks.get("svc")?.map((a) => a.split("\n")[0]);
    expect(order).toEqual([
      "a.ts:5 — Null dereference on payload",
      "a.ts:90 — Null dereference on payload",
      "b.ts:1 — Null dereference on payload",
    ]);
  });

  it("drops a grounding with no repository to attribute it to", () => {
    const asks = buildPostedAsks(
      { a: grounding({ findingId: "a", repoName: "" }) },
      new Map(),
    );
    expect(asks.size).toBe(0);
  });

  it("returns an empty map when nothing was ever posted", () => {
    expect(buildPostedAsks({}, new Map()).size).toBe(0);
  });
});
