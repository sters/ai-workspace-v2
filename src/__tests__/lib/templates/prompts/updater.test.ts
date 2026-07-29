import { describe, it, expect } from "vitest";
import { buildUpdaterPrompt } from "@/lib/templates/prompts/updater";
import type { UpdaterInput } from "@/types/prompts";

const INTERJECT_MARKER =
  "- [!] 中断から再開：作業途中の可能性があるので現在の状態（git status, 編集中のファイル, テスト結果）を確認してから進める";

function baseInput(): UpdaterInput {
  return {
    workspaceName: "demo",
    repoName: "repo-a",
    readmeContent: "## README",
    todoContent: "- [ ] task",
    worktreePath: "/repos/repo-a/worktrees/demo",
    workspacePath: "/ws/demo",
    instruction: "add tests",
  };
}

describe("buildUpdaterPrompt", () => {
  it.each([undefined, false])("omits the interjection notice for interject=%p", (interject) => {
    const prompt = buildUpdaterPrompt({ ...baseInput(), interject });
    expect(prompt).not.toContain("Interjection Notice");
    expect(prompt).not.toContain(INTERJECT_MARKER);
  });

  it("includes the interjection notice section and the verbatim Japanese marker line when interject is true", () => {
    const prompt = buildUpdaterPrompt({ ...baseInput(), interject: true });
    expect(prompt).toContain("## Interjection Notice");
    expect(prompt).toContain(INTERJECT_MARKER);
  });

  it("places the interjection notice before the Working Directory section", () => {
    const prompt = buildUpdaterPrompt({ ...baseInput(), interject: true });
    const noticeIdx = prompt.indexOf("Interjection Notice");
    const workdirIdx = prompt.indexOf("Working Directory");
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(workdirIdx);
  });
});
