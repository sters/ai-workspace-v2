import { describe, it, expect } from "vitest";
import {
  buildFixVerifierPrompt,
} from "@/lib/templates/prompts/fix-verifier";
import type { FixVerifierInput } from "@/types/prompts";

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

  // The gate matches each status back to its ask by number, so the numbering is
  // the contract between this prompt and VERIFY-FIXES-*.md.
  it("enumerates each requested fix from 1", () => {
    const prompt = buildFixVerifierPrompt(baseInput);
    expect(prompt).toContain("1. order-information.tsx:46");
    expect(prompt).toContain("2. promote selectedAtMs into @/utils/time");
  });
});
