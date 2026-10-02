import { describe, it, expect } from "vitest";
import { buildChangeCommentsTodoInstruction } from "@/lib/templates/prompts/change-comments-todo";
import type { ChangeComment } from "@/lib/change-comments";

const web: ChangeComment = {
  id: "1",
  repoPath: "github.com/acme/web",
  repoName: "web",
  filePath: "src/a.ts",
  oldRange: [11, 11],
  newRange: [11, 12],
  text: "-old\n+new\n+more",
  comment: "Rename `more` to something that says what it holds.",
};

describe("buildChangeCommentsTodoInstruction", () => {
  it("sends each comment to its own repository's TODO file, with the lines it is about", () => {
    const text = buildChangeCommentsTodoInstruction([
      web,
      { ...web, id: "2", repoPath: "github.com/acme/api", repoName: "api", filePath: "main.go", comment: "Handle the error." },
    ]);
    const first = text.slice(text.indexOf("### 1."), text.indexOf("### 2."));
    expect(first).toContain("`TODO-web.md`");
    expect(first).toContain("github.com/acme/web/src/a.ts, lines 11-12");
    expect(first).toContain("```diff\n-old\n+new\n+more\n```");
    expect(first).toContain("Rename `more` to something that says what it holds.");
    expect(text.slice(text.indexOf("### 2."))).toContain("`TODO-api.md`");
  });

  it("keeps a multi-line comment intact", () => {
    const text = buildChangeCommentsTodoInstruction([{ ...web, comment: "First.\n\n- and this" }]);
    expect(text).toContain("First.\n\n- and this");
  });
});
