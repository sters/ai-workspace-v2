import {
  getCrossRepositoryReviewerSystemPrompt,
  buildCrossRepositoryReviewerPrompt,
} from "@/lib/templates/prompts/cross-repository-reviewer";
import type { CrossRepositoryReviewerInput } from "@/types/prompts";

describe("getCrossRepositoryReviewerSystemPrompt", () => {
  const prompt = getCrossRepositoryReviewerSystemPrompt();

  it("instructs the reviewer to focus on issues that span multiple repositories", () => {
    expect(prompt.toLowerCase()).toMatch(/cross-repositor|across repositor|between repositor/);
  });

  it("mentions concrete cross-repo concerns such as API contracts or shared types", () => {
    expect(prompt.toLowerCase()).toMatch(/api|contract|interface|shared type|schema/);
  });

  it("does not duplicate per-repository review work", () => {
    expect(prompt.toLowerCase()).toMatch(/do not|don't|avoid/);
  });
});

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

  it("includes workspace and review file path", () => {
    const prompt = buildCrossRepositoryReviewerPrompt(baseInput);
    expect(prompt).toContain("ws");
    expect(prompt).toContain("/tmp/reviews/REVIEW-cross-repository.md");
  });

  it("lists every repository with its path, base branch, and worktree", () => {
    const prompt = buildCrossRepositoryReviewerPrompt(baseInput);
    expect(prompt).toContain("api");
    expect(prompt).toContain("github.com/org/api");
    expect(prompt).toContain("/tmp/api");
    expect(prompt).toContain("web");
    expect(prompt).toContain("github.com/org/web");
    expect(prompt).toContain("/tmp/web");
    expect(prompt).toContain("develop");
  });

  it("includes each repository's changes", () => {
    const prompt = buildCrossRepositoryReviewerPrompt(baseInput);
    expect(prompt).toContain("api diff body");
    expect(prompt).toContain("web diff body");
  });

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
