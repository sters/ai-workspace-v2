import {
  buildCrossRepositoryReviewerPrompt,
  getCrossRepositoryReviewerSystemPrompt,
} from "@/lib/templates/prompts/cross-repository-reviewer";
import type { CrossRepositoryReviewerInput, ReviewScope } from "@/types/prompts";

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

  // The first review of a branch has no baseline for any repo: the whole set of
  // boundaries is new, so nothing is narrowed and no target section is rendered.
  describe("without a baseline", () => {
    it("gives every repo's full branch with no target split", () => {
      const prompt = buildCrossRepositoryReviewerPrompt(baseInput);
      expect(prompt).toContain("api diff body");
      expect(prompt).toContain("web diff body");
      expect(prompt).not.toContain("New Work");
      expect(prompt).not.toContain("Boundary Scope");
    });
  });

  describe("with a baseline", () => {
    const apiScope: ReviewScope = {
      sinceTimestamp: "20260607-120000",
      sinceSha: "aaa1111",
      changedFiles: "M\tschema/order.graphql",
      diffStat: "schema/order.graphql | 4 +-",
      commitLog: "aaa2222 widen orderId",
      hasChanges: true,
    };
    const webScope: ReviewScope = {
      sinceTimestamp: "20260607-120000",
      sinceSha: "bbb1111",
      changedFiles: "",
      diffStat: "",
      commitLog: "",
      hasChanges: false,
    };

    const scoped = (
      overrides?: Partial<ReviewScope>,
      webOverrides?: Partial<ReviewScope>,
    ): CrossRepositoryReviewerInput => ({
      ...baseInput,
      repos: [
        { ...baseInput.repos[0], reviewScope: { ...apiScope, ...overrides } },
        { ...baseInput.repos[1], reviewScope: { ...webScope, ...webOverrides } },
      ],
    });

    it("keeps the full branch as context and names each repo's new work separately", () => {
      const prompt = buildCrossRepositoryReviewerPrompt(scoped());
      // Full branch is still there — a boundary can only be judged against both
      // sides as they now stand, not against a diff.
      expect(prompt).toContain("api diff body");
      expect(prompt).toContain("web diff body");
      // ...but the new work is called out per repo.
      expect(prompt).toContain("New Work");
      expect(prompt).toContain("20260607-120000");
      expect(prompt).toContain("aaa1111");
      expect(prompt).toContain("schema/order.graphql");
    });

    it("states the boundary rule: one side in a repo's new work makes it in scope", () => {
      const prompt = buildCrossRepositoryReviewerPrompt(scoped());
      expect(prompt).toContain("## Boundary Scope");
      expect(prompt).toMatch(/either side/i);
    });

    // The rule competes with the prompt it sits in: by the time the repo diffs
    // are read, `## Boundary Scope` is thousands of tokens above, and the closing
    // line is the last thing the model reads before starting.
    it("restates the rule in the closing instruction, not only up top", () => {
      const closing = buildCrossRepositoryReviewerPrompt(scoped()).split("## Review Report")[1] ?? "";
      expect(closing).toMatch(/New Work/);
    });

    it("leaves the closing instruction alone when nothing is scoped", () => {
      const closing = buildCrossRepositoryReviewerPrompt(baseInput).split("## Review Report")[1] ?? "";
      expect(closing).not.toMatch(/New Work/);
    });

    it("says outright that a repo has not moved since the baseline", () => {
      const prompt = buildCrossRepositoryReviewerPrompt(scoped());
      expect(prompt).toMatch(/web[\s\S]*not (been )?(touched|moved)/i);
    });

    // Every side unchanged means no boundary can newly have broken. Without this
    // the reviewer re-derives the whole contract surface for a third time and
    // reports whatever a fresh reading turns up in code nobody changed.
    it("reports no new cross-repo surface when nothing moved anywhere", () => {
      const prompt = buildCrossRepositoryReviewerPrompt(
        scoped({ changedFiles: "", diffStat: "", commitLog: "", hasChanges: false }),
      );
      expect(prompt).toMatch(/no repository has changed since review 20260607-120000/i);
    });

    // A repo whose range git rejected (rebase, force-push) has no scope at all,
    // and must not be silently read as "unchanged".
    it("treats a repo with no scope as fully in scope, not as unchanged", () => {
      const prompt = buildCrossRepositoryReviewerPrompt({
        ...baseInput,
        repos: [
          { ...baseInput.repos[0], reviewScope: apiScope },
          { ...baseInput.repos[1] },
        ],
      });
      expect(prompt).toContain("no usable baseline");
      expect(prompt).not.toMatch(/no repository has changed/i);
    });
  });
});

describe("getCrossRepositoryReviewerSystemPrompt — incremental scope contract", () => {
  const prompt = getCrossRepositoryReviewerSystemPrompt();

  it("explains what a repo's New Work section means for a boundary", () => {
    expect(prompt).toContain("Review Scope");
    expect(prompt).toContain("New Work");
    expect(prompt).toMatch(/either side/i);
  });

  // The narrowing is on what gets reported, never on what may be read: a contract
  // mismatch is established by reading both sides in full, and most of what a
  // cross-repo reviewer must read is unchanged by definition.
  it("keeps reading unrestricted while narrowing what is reported", () => {
    expect(prompt).toMatch(/read[\s\S]{0,120}freely|freely[\s\S]{0,120}read/i);
  });

  it("keeps every boundary in scope when no baseline is present", () => {
    expect(prompt).toMatch(/New Work.{0,20}block is present anywhere/i);
    expect(prompt).toMatch(/first review of the branch/i);
  });
});
