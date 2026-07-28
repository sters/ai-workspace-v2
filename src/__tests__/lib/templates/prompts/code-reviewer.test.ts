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
});
