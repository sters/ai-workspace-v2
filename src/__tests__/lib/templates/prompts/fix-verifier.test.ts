import { describe, it, expect } from "vitest";
import {
  getFixVerifierSystemPrompt,
  buildFixVerifierPrompt,
} from "@/lib/templates/prompts/fix-verifier";
import type { FixVerifierInput } from "@/types/prompts";

describe("getFixVerifierSystemPrompt", () => {
  const prompt = getFixVerifierSystemPrompt();

  it("defines the three observational statuses", () => {
    expect(prompt).toContain("LANDED");
    expect(prompt).toContain("NOT LANDED");
    expect(prompt).toContain("PARTIAL");
  });

  // The distinction from the gate's existing audit, which cross-references TODO
  // files: a `[x]` means the executor said it did the work, not that it did.
  it("requires the verdict to come from the code, not from TODO checkboxes", () => {
    expect(prompt).toMatch(/checkbox|\[x\]/i);
    expect(prompt.toLowerCase()).toContain("evidence");
  });

  // Without this it becomes a third reviewer and re-creates the finding explosion
  // this whole change exists to stop.
  it("forbids reviewing code quality beyond whether the fix landed", () => {
    expect(prompt.toLowerCase()).toMatch(/do not review|never review|not review/);
    expect(prompt.toLowerCase()).toContain("quality");
  });

  // A NOT LANDED verdict is a hard loop reason downstream, so the verifier must
  // hand the gate the reason rather than deciding validity itself.
  it("asks it to quote a recorded contrary decision instead of judging the ask", () => {
    expect(prompt.toLowerCase()).toMatch(/quote|record/);
    expect(prompt).toMatch(/gate|decide/i);
  });
});

describe("buildFixVerifierPrompt", () => {
  const baseInput: FixVerifierInput = {
    workspaceName: "ws",
    repoName: "repo",
    repoPath: "github.com/org/repo",
    baseBranch: "main",
    reviewTimestamp: "20260728-162200",
    worktreePath: "/tmp/worktree",
    requestedFixes: [
      "order-information.tsx:46 — gate the anchor on a defined href",
      "promote selectedAtMs into @/utils/time",
    ],
    verifyFilePath: "/tmp/VERIFY-FIXES-repo.md",
  };

  it("enumerates each requested fix so the report can be matched back", () => {
    const prompt = buildFixVerifierPrompt(baseInput);
    expect(prompt).toContain("1. order-information.tsx:46");
    expect(prompt).toContain("2. promote selectedAtMs into @/utils/time");
  });

  it("includes repo, worktree and the report path", () => {
    const prompt = buildFixVerifierPrompt(baseInput);
    expect(prompt).toContain("github.com/org/repo");
    expect(prompt).toContain("/tmp/worktree");
    expect(prompt).toContain("/tmp/VERIFY-FIXES-repo.md");
  });

  it("passes the incremental range when one is known", () => {
    const prompt = buildFixVerifierPrompt({
      ...baseInput,
      sinceSha: "abc1234",
      sinceTimestamp: "20260727-181719",
    });
    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("20260727-181719");
  });
});
