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
});
