import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  anchorComment,
  buildCommentsTopic,
  loadChangeComments,
  saveChangeComments,
  type ChangeComment,
} from "@/lib/change-comments";
import { hunkBody, mapHunkLines } from "@/lib/unified-diff";

const base: ChangeComment = {
  id: "1",
  repoPath: "github.com/acme/web",
  repoName: "web",
  filePath: "src/a.ts",
  oldRange: [11, 11],
  newRange: [11, 12],
  text: "-old\n+new\n+more",
  comment: "",
};

describe("buildCommentsTopic", () => {
  it("locates each selection relative to the workspace and quotes it as a diff", () => {
    const topic = buildCommentsTopic([base]);
    expect(topic).toContain("github.com/acme/web/src/a.ts, lines 11-12");
    expect(topic).toContain("```diff\n-old\n+new\n+more\n```");
  });

  it("puts the comment after the lines it is about, and nothing for a bare selection", () => {
    const topic = buildCommentsTopic([
      { ...base, comment: "Why not reuse parseDate?" },
      { ...base, id: "2", filePath: "src/b.ts" },
    ]);
    expect(topic).toContain("+more\n```\nMy comment: Why not reuse parseDate?");
    expect(topic.split("My comment:")).toHaveLength(2);
  });

  it("numbers removed-only selections on the base side", () => {
    const topic = buildCommentsTopic([{ ...base, newRange: null, oldRange: [5, 5], text: "-gone" }]);
    expect(topic).toContain("src/a.ts, removed line 5 of the base version");
  });

  it("lengthens the fence when the quoted code contains one", () => {
    const topic = buildCommentsTopic([{ ...base, text: "+```ts\n+x\n+```" }]);
    expect(topic).toContain("````diff\n+```ts\n+x\n+```\n````");
  });

  it("keeps every selection, in the order they were added", () => {
    const topic = buildCommentsTopic([
      base,
      { ...base, id: "2", filePath: "src/b.ts", newRange: [3, 3], text: "+b" },
    ]);
    expect(topic.indexOf("src/a.ts")).toBeLessThan(topic.indexOf("src/b.ts"));
    expect(topic).toMatch(/1\. .*src\/a\.ts/);
    expect(topic).toMatch(/2\. .*src\/b\.ts, line 3/);
  });
});

describe("anchorComment", () => {
  const diff = [
    "@@ -10,3 +10,4 @@",
    " keep",
    "-old",
    "+new",
    "+more",
    " tail",
    "@@ -40,2 +41,2 @@",
    " keep",
    "-old",
    "+new",
  ].join("\n");
  const lines = mapHunkLines(hunkBody(diff));

  it("finds the editor lines a comment was made on", () => {
    expect(anchorComment(lines, base)).toEqual({ fromLine: 3, toLine: 5 });
  });

  it("tells identical text in two hunks apart by its line numbers", () => {
    const second = { oldRange: [41, 41] as [number, number], newRange: [42, 42] as [number, number], text: "-old\n+new" };
    expect(anchorComment(lines, second)).toEqual({ fromLine: 9, toLine: 10 });
  });

  it("does not anchor a comment whose lines no longer read the same", () => {
    expect(anchorComment(lines, { ...base, text: "-old\n+changed\n+more" })).toBeNull();
  });

  it("does not anchor a selection with no file line in it", () => {
    expect(anchorComment(lines, { oldRange: null, newRange: null, text: "@@ -10,3 +10,4 @@" })).toBeNull();
  });
});

describe("loadChangeComments", () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips what was saved", () => {
    saveChangeComments("ws", [base]);
    expect(loadChangeComments("ws")).toEqual([base]);
  });

  it("drops an entry stored before comments existed", () => {
    const { comment: _comment, repoName: _repoName, ...old } = base;
    sessionStorage.setItem("aiw-change-comments:ws", JSON.stringify([old, base]));
    expect(loadChangeComments("ws")).toEqual([base]);
  });
});
