import { describe, it, expect } from "vitest";
import { parseDiffHunks, resolveAnchor } from "@/lib/workspace/diff-anchors";
import type { ReviewFinding } from "@/types/review-findings";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,7 +10,9 @@ export function a() {
 context
-removed
+added
+added2
 context
 context
 context
 context
@@ -80,3 +82,3 @@ export function b() {
 x
-y
+z
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-one
+uno
 two
`;

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: "f1",
    repoName: "widgets",
    path: "src/a.ts",
    line: 11,
    startLine: null,
    side: "RIGHT",
    severity: "warning",
    confidence: "high",
    title: "t",
    body: "b",
    suggestion: null,
    ...overrides,
  };
}

describe("parseDiffHunks", () => {
  it("reads each file's post-change line ranges from the hunk headers", () => {
    const files = parseDiffHunks(DIFF);
    const a = files.get("src/a.ts");
    expect(a).toBeDefined();
    expect(a?.right).toEqual([
      { start: 10, end: 18 },
      { start: 82, end: 84 },
    ]);
  });

  it("reads the pre-change ranges too, for a finding about removed code", () => {
    const a = parseDiffHunks(DIFF).get("src/a.ts");
    expect(a?.left).toEqual([
      { start: 10, end: 16 },
      { start: 80, end: 82 },
    ]);
  });

  it("keeps files separate", () => {
    const files = parseDiffHunks(DIFF);
    expect([...files.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files.get("src/b.ts")?.right).toEqual([{ start: 1, end: 2 }]);
  });

  // `@@ -1 +1 @@` omits the count, which means exactly one line.
  it("treats an omitted hunk count as one line", () => {
    const files = parseDiffHunks(
      `--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n`,
    );
    expect(files.get("x.ts")?.right).toEqual([{ start: 1, end: 1 }]);
  });

  // A deleted file has no post-change side at all, so nothing can be commented
  // on its RIGHT — but its LEFT is still real.
  it("records a deleted file with no right-side range", () => {
    const files = parseDiffHunks(
      `--- a/gone.ts\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c\n`,
    );
    expect(files.get("gone.ts")?.right).toEqual([]);
    expect(files.get("gone.ts")?.left).toEqual([{ start: 1, end: 3 }]);
  });

  it("records an added file from its post-change side", () => {
    const files = parseDiffHunks(
      `--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n`,
    );
    expect(files.get("new.ts")?.right).toEqual([{ start: 1, end: 2 }]);
    expect(files.get("new.ts")?.left).toEqual([]);
  });

  it("unquotes a path containing a space", () => {
    const files = parseDiffHunks(
      `--- "a/src/my file.ts"\n+++ "b/src/my file.ts"\n@@ -1,1 +1,1 @@\n-a\n+b\n`,
    );
    expect([...files.keys()]).toEqual(["src/my file.ts"]);
  });

  it("yields nothing for an empty diff", () => {
    expect(parseDiffHunks("").size).toBe(0);
  });
});

describe("resolveAnchor", () => {
  const hunks = parseDiffHunks(DIFF);

  it("anchors a line inside a hunk inline", () => {
    expect(resolveAnchor(finding({ line: 11 }), hunks)).toEqual({
      anchor: "inline",
      anchorReason: null,
    });
  });

  it("anchors a context line inside a hunk inline, not just a changed one", () => {
    // 18 is the last line of the first hunk's 9-line window — context, but
    // GitHub accepts it because it is part of the diff.
    expect(resolveAnchor(finding({ line: 18 }), hunks).anchor).toBe("inline");
  });

  // The line is real but nothing on the branch touched it, so GitHub has no
  // diff position for it. A file-level comment still lands.
  it("falls back to a file-level comment when the line is outside every hunk", () => {
    const resolved = resolveAnchor(finding({ line: 50 }), hunks);
    expect(resolved.anchor).toBe("file");
    expect(resolved.anchorReason).toMatch(/not part of the diff/i);
  });

  it("falls back to a file-level comment when the reviewer gave no line", () => {
    expect(resolveAnchor(finding({ line: null }), hunks).anchor).toBe("file");
  });

  // Nothing on the PR points at this file, so even a file-level comment is
  // rejected — it can only go in the review body.
  it("falls back to the review body when the file is not in the diff at all", () => {
    const resolved = resolveAnchor(finding({ path: "src/untouched.ts" }), hunks);
    expect(resolved.anchor).toBe("pr-body");
    expect(resolved.anchorReason).toMatch(/not in the pull request diff/i);
  });

  it("resolves a LEFT-side finding against the pre-change ranges", () => {
    expect(resolveAnchor(finding({ side: "LEFT", line: 81 }), hunks).anchor).toBe("inline");
    // 84 exists on the right but not on the left.
    expect(resolveAnchor(finding({ side: "LEFT", line: 84 }), hunks).anchor).toBe("file");
  });

  // A range comment needs both ends in the diff; GitHub rejects the pair
  // otherwise, and dropping to file-level keeps the finding postable.
  it("requires both ends of a multi-line range to be in a hunk", () => {
    expect(resolveAnchor(finding({ startLine: 11, line: 13 }), hunks).anchor).toBe("inline");
    expect(resolveAnchor(finding({ startLine: 5, line: 13 }), hunks).anchor).toBe("file");
  });

  it("ignores a startLine that is not before the line", () => {
    // Equal or inverted is not a range — treat it as a single-line comment.
    expect(resolveAnchor(finding({ startLine: 11, line: 11 }), hunks).anchor).toBe("inline");
    expect(resolveAnchor(finding({ startLine: 14, line: 11 }), hunks).anchor).toBe("inline");
  });

  it("puts everything in the review body when the diff could not be read", () => {
    const resolved = resolveAnchor(finding({}), new Map());
    expect(resolved.anchor).toBe("pr-body");
  });
});
