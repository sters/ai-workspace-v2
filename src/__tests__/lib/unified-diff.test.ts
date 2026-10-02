import { describe, it, expect } from "vitest";
import {
  hunkBody,
  mapHunkLines,
  describeLineRange,
  diffGutterLabels,
  parseDiffByFile,
} from "@/lib/unified-diff";

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,4 +10,5 @@ function a() {",
  " keep10",
  "-old11",
  "+new11",
  "+new12",
  " keep12",
  "@@ -40,2 +41,2 @@",
  " keep40",
  "-old41",
  "+new42",
].join("\n");

describe("mapHunkLines", () => {
  const lines = mapHunkLines(hunkBody(DIFF));

  it("numbers each side from its hunk header", () => {
    expect(lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["hunk", null, null],
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["add", null, 12],
      ["context", 12, 13],
      ["hunk", null, null],
      ["context", 40, 41],
      ["del", 41, null],
      ["add", null, 42],
    ]);
  });
});

describe("describeLineRange", () => {
  const lines = mapHunkLines(hunkBody(DIFF));

  it("reports the new-side range and the diff lines as selected", () => {
    // Editor lines are 1-based: lines 3..5 are `-old11`, `+new11`, `+new12`.
    const range = describeLineRange(lines, 3, 5);
    expect(range.newRange).toEqual([11, 12]);
    expect(range.oldRange).toEqual([11, 11]);
    expect(range.text).toBe("-old11\n+new11\n+new12");
  });

  it("has no new-side range for a selection of removed lines only", () => {
    const range = describeLineRange(lines, 3, 3);
    expect(range.newRange).toBeNull();
    expect(range.oldRange).toEqual([11, 11]);
  });

  it("keeps a hunk header inside the selection out of the ranges", () => {
    const range = describeLineRange(lines, 6, 8);
    expect(range.newRange).toEqual([13, 41]);
    expect(range.text).toContain("@@ -40,2 +41,2 @@");
  });

  it("clamps a range that runs past the end", () => {
    expect(describeLineRange(lines, 9, 99).newRange).toEqual([42, 42]);
  });
});

describe("diffGutterLabels", () => {
  // The gutter collapses ordinary spaces, so the labels pad with NBSP.
  const shown = (label: string) => label.replaceAll("\u00a0", " ");

  it("labels each line with its old and new file line numbers", () => {
    const { labels, chars } = diffGutterLabels(mapHunkLines(hunkBody(DIFF)));
    expect(labels.map(shown)).toEqual([
      "",
      "10 10",
      "11   ",
      "   11",
      "   12",
      "12 13",
      "",
      "40 41",
      "41   ",
      "   42",
    ]);
    expect(chars).toBe(5);
  });

  it("pads every label to the widest number in the file", () => {
    const { labels, chars } = diffGutterLabels(
      mapHunkLines(["@@ -9,2 +99,3 @@", " a", "-b", "+c", "+d"].join("\n")),
    );
    expect(labels.map(shown)).toEqual(["", "  9  99", " 10    ", "    100", "    101"]);
    expect(chars).toBe(7);
  });

  it("leaves a no-newline marker unnumbered", () => {
    const { labels } = diffGutterLabels(
      mapHunkLines(["@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+a"].join("\n")),
    );
    expect(labels.map(shown)).toEqual(["", "1  ", "", "  1"]);
  });
});

describe("parseDiffByFile", () => {
  it("splits a multi-file diff and counts each file's lines", () => {
    const files = parseDiffByFile(`${DIFF}\n${DIFF.replaceAll("src/a.ts", "src/b.ts")}`);
    expect(files.map((f) => [f.filename, f.additions, f.deletions])).toEqual([
      ["src/a.ts", 3, 2],
      ["src/b.ts", 3, 2],
    ]);
  });
});
