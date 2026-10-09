import {
  getCodeReviewerSystemPrompt,
  buildCodeReviewerPrompt,
} from "@/lib/templates/prompts/code-reviewer";
import type { CodeReviewerInput } from "@/types/prompts";

describe("getCodeReviewerSystemPrompt", () => {
  const prompt = getCodeReviewerSystemPrompt();

  // The reviewer used to be told to discover and run the repo's lint/test
  // commands and report failures as Critical Issues. The `Verify constraints`
  // phase already runs the README's declared commands deterministically and
  // classifies each failure against the merge-base, so the reviewer's copy only
  // added a second, unclassified verdict on the same commands — a failure that
  // predates the branch reached the autonomous gate as a blocker.
  it("does not instruct the reviewer to run lint/test/build commands itself", () => {
    expect(prompt).not.toMatch(/\*\*Run Lint & Tests\*\*/);
    expect(prompt).not.toMatch(/run them\. Report any failures as \*\*Critical Issues\*\*/);
  });
});

describe("buildCodeReviewerPrompt", () => {
  const baseInput: CodeReviewerInput = {
    workspaceName: "ws",
    repoName: "repo",
    repoPath: "github.com/org/repo",
    baseBranch: "main",
    reviewTimestamp: "2026-05-26T00:00:00Z",
    worktreePath: "/tmp/worktree",
    readmeContent: "# readme",
    repoChanges: "diff body",
    reviewFilePath: "/tmp/review.md",
  };

  it("includes the known-findings ledger when the workspace has one", () => {
    const prompt = buildCodeReviewerPrompt({
      ...baseInput,
      knownFindings: "- **[out-of-scope]** (cycle 1) BFF collapses ShopOrders",
    });
    expect(prompt).toContain("## Known / Accepted Findings");
    expect(prompt).toContain("BFF collapses ShopOrders");
  });

  it("omits the known-findings section when the ledger is absent or empty", () => {
    expect(buildCodeReviewerPrompt(baseInput)).not.toContain("Known / Accepted Findings");
    expect(
      buildCodeReviewerPrompt({ ...baseInput, knownFindings: "  \n" }),
    ).not.toContain("Known / Accepted Findings");
  });

  describe("incremental review scope", () => {
    const scope = {
      sinceTimestamp: "20260727-181719",
      sinceSha: "abc1234",
      changedFiles: "M\tsrc/hook.ts",
      diffStat: " src/hook.ts | 12 ++--",
      commitLog: "b4224e2 Review follow-ups",
      hasChanges: true,
    };

    it("reviews the whole branch when no baseline is available", () => {
      const prompt = buildCodeReviewerPrompt(baseInput);
      expect(prompt).toContain("## Repository Changes");
      expect(prompt).toContain("diff body");
      expect(prompt).not.toContain("Review Target");
    });

    it("splits the branch into context and the incremental range into the review target", () => {
      const prompt = buildCodeReviewerPrompt({ ...baseInput, reviewScope: scope });
      expect(prompt).toContain("## Change Context");
      expect(prompt).toContain("## Review Target");
      // The full-branch material stays, as context.
      expect(prompt).toContain("diff body");
      // The incremental material is what gets reviewed.
      expect(prompt).toContain("src/hook.ts");
      expect(prompt).toContain("b4224e2 Review follow-ups");
      expect(prompt).toContain("20260727-181719");
    });

    it("says so explicitly when nothing changed since the baseline", () => {
      const prompt = buildCodeReviewerPrompt({
        ...baseInput,
        reviewScope: { ...scope, changedFiles: "", diffStat: "", commitLog: "", hasChanges: false },
      });
      expect(prompt).toContain("## Review Target");
      expect(prompt.toLowerCase()).toContain("no changes");
    });
  });
});

