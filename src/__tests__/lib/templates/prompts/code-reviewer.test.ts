import {
  getCodeReviewerSystemPrompt,
  buildCodeReviewerPrompt,
} from "@/lib/templates/prompts/code-reviewer";
import type { CodeReviewerInput } from "@/types/prompts";

describe("getCodeReviewerSystemPrompt", () => {
  const prompt = getCodeReviewerSystemPrompt();

  it("instructs the reviewer to scan for repeated patterns in 3 or more locations", () => {
    expect(prompt).toMatch(/3 or more|3\+/);
    expect(prompt.toLowerCase()).toMatch(/repeat|duplicat/);
  });

  it("mentions extraction targets such as helper, hook, function, or constant", () => {
    expect(prompt.toLowerCase()).toMatch(/extract/);
    expect(prompt.toLowerCase()).toMatch(/helper|hook|function|constant/);
  });

  it("classifies refactoring/extraction opportunities under Suggestions only", () => {
    expect(prompt).toMatch(
      /Suggestions only|never (?:be )?(?:classified as )?(?:Critical|Warning)/i,
    );
  });

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

  it("points lint/test execution at the Verify constraints phase and its merge-base classification", () => {
    expect(prompt).toContain("Verify constraints");
    expect(prompt).toMatch(/merge-base/);
  });

  it("still asks the reviewer to judge test coverage from the diff", () => {
    expect(prompt).toMatch(/test coverage/i);
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

  it("includes workspace, repo, base branch, and worktree path", () => {
    const prompt = buildCodeReviewerPrompt(baseInput);
    expect(prompt).toContain("ws");
    expect(prompt).toContain("repo");
    expect(prompt).toContain("main");
    expect(prompt).toContain("/tmp/worktree");
  });

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

    // Context that reads like a review target is the failure mode here: the whole
    // point is that the reviewer not re-report findings in already-reviewed code.
    it("marks the change context as not-to-be-reviewed", () => {
      const prompt = buildCodeReviewerPrompt({ ...baseInput, reviewScope: scope });
      const contextHeading = prompt.split("## Change Context")[1]?.split("##")[0] ?? "";
      expect(contextHeading.toLowerCase()).toContain("do not review");
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

describe("getCodeReviewerSystemPrompt — incremental scope contract", () => {
  const prompt = getCodeReviewerSystemPrompt();

  it("tells the reviewer to confine findings to the review target when one is given", () => {
    expect(prompt).toContain("Review Target");
    expect(prompt).toContain("Change Context");
  });

  // Without this the incremental scope would silently drop the regression net:
  // a reviewer told "only look here" must still be allowed to read outward.
  it("still permits reading outside the target for context", () => {
    expect(prompt.toLowerCase()).toContain("read");
    expect(prompt).toMatch(/outside the .*target|beyond the .*target/i);
  });
});
