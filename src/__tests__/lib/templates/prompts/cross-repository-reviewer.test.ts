import { buildCrossRepositoryReviewerPrompt } from "@/lib/templates/prompts/cross-repository-reviewer";
import type { CrossRepositoryReviewerInput } from "@/types/prompts";

describe("buildCrossRepositoryReviewerPrompt", () => {
  const baseInput: CrossRepositoryReviewerInput = {
    workspaceName: "ws",
    reviewTimestamp: "2026-06-08T00:00:00Z",
    readmeContent: "# readme",
    reviewFilePath: "/tmp/reviews/REVIEW-cross-repository.md",
    repos: [
      {
        repoName: "api",
        repoPath: "github.com/org/api",
        baseBranch: "main",
        worktreePath: "/tmp/api",
        repoChanges: "api diff body",
      },
      {
        repoName: "web",
        repoPath: "github.com/org/web",
        baseBranch: "develop",
        worktreePath: "/tmp/web",
        repoChanges: "web diff body",
      },
    ],
  };

  it("includes the known-findings ledger when the workspace has one", () => {
    const prompt = buildCrossRepositoryReviewerPrompt({
      ...baseInput,
      knownFindings: "- **[infeasible]** (cycle 2) Criterion 4 cannot be satisfied",
    });
    expect(prompt).toContain("## Known / Accepted Findings");
    expect(prompt).toContain("Criterion 4 cannot be satisfied");
  });

  it("omits the known-findings section when the ledger is absent", () => {
    expect(buildCrossRepositoryReviewerPrompt(baseInput)).not.toContain(
      "Known / Accepted Findings",
    );
  });
});
