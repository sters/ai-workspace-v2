import { describe, it, expect } from "vitest";
import { findingId, parseFindingsFile } from "@/lib/workspace/review-findings";

const VALID = JSON.stringify({
  version: 1,
  repoName: "widgets",
  findings: [
    {
      path: "src/a.ts",
      line: 11,
      startLine: 9,
      side: "RIGHT",
      severity: "critical",
      confidence: "high",
      title: "Unhandled rejection",
      body: "`fetchUser` can reject and nothing catches it.",
      suggestion: "await fetchUser().catch(report)",
    },
    {
      path: "src/b.ts",
      line: null,
      severity: "Suggestion",
      confidence: "low",
      title: "Naming",
      body: "`x` could say what it holds.",
    },
  ],
});

describe("findingId", () => {
  it("is stable for the same finding", () => {
    const a = findingId("widgets", "src/a.ts", 11, "RIGHT", "body text");
    const b = findingId("widgets", "src/a.ts", 11, "RIGHT", "body text");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("separates findings that differ in any coordinate", () => {
    const base = findingId("widgets", "src/a.ts", 11, "RIGHT", "body");
    expect(findingId("gadgets", "src/a.ts", 11, "RIGHT", "body")).not.toBe(base);
    expect(findingId("widgets", "src/b.ts", 11, "RIGHT", "body")).not.toBe(base);
    expect(findingId("widgets", "src/a.ts", 12, "RIGHT", "body")).not.toBe(base);
    expect(findingId("widgets", "src/a.ts", 11, "LEFT", "body")).not.toBe(base);
    expect(findingId("widgets", "src/a.ts", 11, "RIGHT", "other")).not.toBe(base);
  });

  // The id is what matches an already-posted comment, and only the body's first
  // line survives into the comment's marker-bearing text unchanged.
  it("ignores everything after the body's first line", () => {
    expect(findingId("w", "a.ts", 1, "RIGHT", "one\ntwo")).toBe(
      findingId("w", "a.ts", 1, "RIGHT", "one\nthree"),
    );
  });
});

describe("parseFindingsFile", () => {
  it("reads the findings the reviewer wrote", () => {
    const findings = parseFindingsFile(VALID, "widgets");
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      repoName: "widgets",
      path: "src/a.ts",
      line: 11,
      startLine: 9,
      side: "RIGHT",
      severity: "critical",
      confidence: "high",
      title: "Unhandled rejection",
      suggestion: "await fetchUser().catch(report)",
    });
    expect(findings[0].id).toBe(
      findingId("widgets", "src/a.ts", 11, "RIGHT", findings[0].body),
    );
  });

  it("lowercases a severity the reviewer capitalised", () => {
    expect(parseFindingsFile(VALID, "widgets")[1].severity).toBe("suggestion");
  });

  it("takes the repo name from the caller, not the file", () => {
    // The filename is what ties a findings file to a worktree; a repoName in the
    // JSON is the model's copy of it and can disagree.
    const findings = parseFindingsFile(VALID, "gadgets");
    expect(findings.every((f) => f.repoName === "gadgets")).toBe(true);
  });

  it("accepts a bare array as well as the wrapped shape", () => {
    const raw = JSON.stringify([{ path: "a.ts", line: 1, body: "b", title: "t" }]);
    expect(parseFindingsFile(raw, "widgets")).toHaveLength(1);
  });

  // An unknown severity renders but stays unchecked by default. Guessing
  // "warning" would tick a comment onto someone's PR on an unparsed label.
  it("falls back to suggestion for an unknown severity", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 1, severity: "blocker", title: "t", body: "b" },
    ]);
    expect(parseFindingsFile(raw, "w")[0].severity).toBe("suggestion");
  });

  it("falls back to medium confidence, matching the gate's own rule", () => {
    const raw = JSON.stringify([{ path: "a.ts", line: 1, title: "t", body: "b" }]);
    expect(parseFindingsFile(raw, "w")[0].confidence).toBe("medium");
  });

  it("defaults side to the post-change file", () => {
    const raw = JSON.stringify([{ path: "a.ts", line: 1, title: "t", body: "b" }]);
    expect(parseFindingsFile(raw, "w")[0].side).toBe("RIGHT");
  });

  it("reads LEFT when the finding is about removed code", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 1, side: "left", title: "t", body: "b" },
    ]);
    expect(parseFindingsFile(raw, "w")[0].side).toBe("LEFT");
  });

  it("nulls a line that is not a usable file position", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 0, title: "t", body: "b" },
      { path: "b.ts", line: -3, title: "t", body: "b" },
      { path: "c.ts", line: "12", title: "t", body: "b" },
    ]);
    const findings = parseFindingsFile(raw, "w");
    expect(findings.map((f) => f.line)).toEqual([null, null, 12]);
  });

  it("fills a missing title from the body and vice versa", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 1, body: "first line\nsecond" },
      { path: "b.ts", line: 1, title: "only a title" },
    ]);
    const findings = parseFindingsFile(raw, "w");
    expect(findings[0].title).toBe("first line");
    expect(findings[1].body).toBe("only a title");
  });

  it("drops an entry with no path or no text at all", () => {
    const raw = JSON.stringify([
      { line: 1, title: "t", body: "b" },
      { path: "a.ts", line: 1 },
      { path: "ok.ts", line: 1, title: "t", body: "b" },
    ]);
    expect(parseFindingsFile(raw, "w").map((f) => f.path)).toEqual(["ok.ts"]);
  });

  it("drops a blank suggestion rather than posting an empty code block", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 1, title: "t", body: "b", suggestion: "   " },
    ]);
    expect(parseFindingsFile(raw, "w")[0].suggestion).toBeNull();
  });

  // Fail-soft in every direction: a review whose findings file the model mangled
  // still renders its markdown report, it just cannot be posted from.
  it("yields nothing for unreadable content", () => {
    expect(parseFindingsFile("not json", "w")).toEqual([]);
    expect(parseFindingsFile("", "w")).toEqual([]);
    expect(parseFindingsFile("null", "w")).toEqual([]);
    expect(parseFindingsFile(JSON.stringify({ findings: "nope" }), "w")).toEqual([]);
  });

  it("deduplicates findings that land on the same id", () => {
    const raw = JSON.stringify([
      { path: "a.ts", line: 1, title: "t", body: "same" },
      { path: "a.ts", line: 1, title: "t", body: "same" },
    ]);
    expect(parseFindingsFile(raw, "w")).toHaveLength(1);
  });
});
