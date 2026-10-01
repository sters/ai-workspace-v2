import { describe, it, expect } from "vitest";
import { buildFileTree } from "@/lib/file-tree";

describe("buildFileTree", () => {
  it("puts each directory before its contents, and directories before files", () => {
    const rows = buildFileTree(["src/z.ts", "README.md", "src/lib/a.ts", "src/b.ts"]);
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.isDir ? "/" : ""}`)).toEqual([
      "src/",
      "  lib/",
      "    a.ts",
      "  b.ts",
      "  z.ts",
      "README.md",
    ]);
  });

  it("folds a chain of single-directory directories into one row", () => {
    const rows = buildFileTree(["apps/web/src/a.ts", "apps/web/src/lib/b.ts", "apps/web/src/lib/c.ts"]);
    expect(rows.map((r) => `${r.depth}:${r.name}:${r.path}`)).toEqual([
      "0:apps/web/src:apps/web/src",
      "1:lib:apps/web/src/lib",
      "2:b.ts:apps/web/src/lib/b.ts",
      "2:c.ts:apps/web/src/lib/c.ts",
      "1:a.ts:apps/web/src/a.ts",
    ]);
  });

  it("does not fold a directory that also holds files", () => {
    const rows = buildFileTree(["a/x.ts", "a/b/c.ts"]);
    expect(rows.map((r) => r.name)).toEqual(["a", "b", "c.ts", "x.ts"]);
  });
});
