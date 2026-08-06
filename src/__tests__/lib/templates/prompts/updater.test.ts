import { describe, it, expect } from "vitest";
import {
  buildUpdaterPrompt,
  getUpdaterSystemPrompt,
} from "@/lib/templates/prompts/updater";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
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

describe("getUpdaterSystemPrompt", () => {
  const prompt = getUpdaterSystemPrompt();

  // The updater deletes `[x]` items every cycle. If it took the thread record
  // with them, create-pr would have nothing left to reply to — and the rows it
  // needs are exactly the ones belonging to the items just deleted.
  it("protects the PR review thread record from the delete-completed rule", () => {
    expect(prompt).toContain(PR_REVIEW_THREADS_HEADING);
    const deleteIdx = prompt.indexOf("ALWAYS delete completed TODO items");
    const protectIdx = prompt.indexOf(PR_REVIEW_THREADS_HEADING);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(protectIdx).toBeGreaterThan(deleteIdx);
  });

  // Both derivation rules sit after SCOPE_DISCIPLINE on purpose: that rule is what
  // suppressed them. Handed three named sites, the updater enumerated its doc
  // targets from the files it was already editing, so the interface doc — the one
  // the caller actually codes against, and the only file with no code change of its
  // own — kept stating the pre-change contract and became the next cycle's Warning.
  it("derives doc targets from who states the contract, not from the files it edits", () => {
    const scopeIdx = prompt.indexOf("### Scope");
    const targetsIdx = prompt.indexOf("### Deriving an Item's Targets");
    expect(scopeIdx).toBeGreaterThan(-1);
    expect(targetsIdx).toBeGreaterThan(scopeIdx);
    const section = prompt.slice(targetsIdx);
    expect(section).toMatch(/interface/i);
    expect(section).toMatch(/no code change/i);
    // Inert unless it says this is not the widening SCOPE_DISCIPLINE forbids.
    expect(section).toMatch(/not widening/i);
  });

  // The asymmetry that cost one run its final cycle: the updater expanded the code
  // items past the gate's asks (correctly, adding three doc sites nobody named) but
  // took the test asks verbatim, so five changed return sites shipped with two
  // covered and the other three came back as the next review's Warnings.
  it("requires test items to cover every site the code items change", () => {
    const section = prompt.slice(prompt.indexOf("### Deriving an Item's Targets"));
    expect(section).toMatch(/return sites/i);
    expect(section).toMatch(/floor, not the ceiling/i);
  });
});

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
