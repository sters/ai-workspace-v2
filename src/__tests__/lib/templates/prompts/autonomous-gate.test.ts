import { describe, expect, it } from "vitest";
import {
  buildAutonomousGatePrompt,
  getAutonomousGateSystemPrompt,
  AUTONOMOUS_GATE_SCHEMA,
} from "@/lib/templates/prompts/autonomous-gate";
import { KNOWN_FINDING_KINDS } from "@/lib/workspace/known-findings";

describe("AUTONOMOUS_GATE_SCHEMA", () => {
  // A verdict without the list falls back to "every repository unfinished",
  // so leaving it optional would quietly turn per-repository completion off.
  it("requires unfinishedRepositories", () => {
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("unfinishedRepositories");
  });

  it("requires dismissedFindings so a dismissal is never silent", () => {
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("dismissedFindings");
    const dismissed = AUTONOMOUS_GATE_SCHEMA.properties.dismissedFindings as {
      items: { required: string[]; properties: { kind: { enum: string[] } } };
    };
    expect(dismissed.items.required).toEqual(
      expect.arrayContaining(["summary", "reason", "kind"]),
    );
    // The enum must match the ledger's kinds, or entries land on the fallback.
    expect(dismissed.items.properties.kind.enum).toEqual([...KNOWN_FINDING_KINDS]);
  });
});

describe("buildAutonomousGatePrompt", () => {
  const baseInput = {
    workspaceName: "test-ws",
    reviewSummary: "# Review Summary\n2 critical issues found.",
    reviewFiles: [
      { name: "review-repo-a.md", content: "Critical: missing error handling" },
    ],
    todoFiles: [
      { repoName: "repo-a", content: "- [ ] Add error handling\n- [x] Setup project" },
    ],
    readmeContent: "# Test Workspace\nFix bugs in repo-a.",
    loopIteration: 1,
    maxLoops: 3,
  };

  // The final cycle used to be told to report `shouldLoop: false` "regardless of
  // issues found", which handed a PR to the human with the run's own leftovers in
  // it. Now it reports the truth and the pipeline stops instead.
  it("tells the final cycle that remaining work stops the run instead of looping", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      loopIteration: 3,
      maxLoops: 3,
    });
    expect(prompt).toContain("FINAL cycle");
    expect(prompt).toMatch(/no PR is created for any repository in `unfinishedRepositories`/);
    expect(prompt).toMatch(/`shouldLoop: true`/);
    expect(prompt).not.toMatch(/MUST set `shouldLoop: false`/);
  });

  it("does not add the final-cycle note when below max loops", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).not.toContain("FINAL cycle");
  });

  // The bar is the run's own deliverable: is the contract implemented, correct
  // and complete. "Default to fixing" plus a reviewer that reports every nit
  // meant cycle 1 always looped, so a one-line task cost three cycles.
  it("loops on the work not being done, not on anything actionable", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).not.toContain("Default to fixing");
    expect(systemPrompt).not.toContain("Err on the side of addressing issues");
    expect(systemPrompt).toMatch(/review[- ]ready/i);
    expect(systemPrompt).toMatch(/Critical \/ Must-Fix \/ Should-Fix/);
  });

  it("keeps the Decision Criteria list contiguously numbered", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    const section = systemPrompt.slice(
      systemPrompt.indexOf("### Decision Criteria"),
      systemPrompt.indexOf("### Confidence Filtering"),
    );
    const numbers = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  // The reader half of the same axis the reviewer writes on. A finding that
  // verified its mechanism and only flagged the triggering input as unconfirmed
  // is not a suspicion, whatever label it arrived with — mislabelling it low is
  // how a verified regression this branch introduced got recorded and dropped.
  it("reads confidence as mechanism certainty, not input likelihood", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toMatch(/mechanism/i);
    expect(systemPrompt).toMatch(/unconfirmed|whether the (triggering )?input/i);
    expect(systemPrompt).toMatch(/not low confidence|treat it as high/i);
  });

  it("includes previous gate results when provided", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      loopIteration: 2,
      previousGateResults: [
        { cycle: 1, reason: "Fix typo found", fixableIssues: ["Fix typo in main.go"] },
      ],
    });
    expect(prompt).toContain("Previous Gate Decisions");
    expect(prompt).toContain("Cycle 1");
    expect(prompt).toContain("Fix typo found");
    expect(prompt).toContain("Fix typo in main.go");
  });

  it.each([[[]], [undefined]])(
    "does not include previous gate results section for %p",
    (previousGateResults) => {
      const prompt = buildAutonomousGatePrompt({ ...baseInput, previousGateResults });
      expect(prompt).not.toContain("Previous Gate Decisions");
    },
  );

  describe("known / accepted findings", () => {
    it("includes the ledger when the workspace has one", () => {
      const prompt = buildAutonomousGatePrompt({
        ...baseInput,
        knownFindings: "- **[infeasible]** (cycle 1) Criterion 4 cannot be satisfied",
      });
      expect(prompt).toContain("## Known / Accepted Findings");
      expect(prompt).toContain("Criterion 4 cannot be satisfied");
    });

    it("omits the section when the ledger is empty", () => {
      expect(buildAutonomousGatePrompt(baseInput)).not.toContain("Known / Accepted Findings");
    });
  });

  describe("dismissed findings", () => {
    it("explains what to record and why the next cycle depends on it", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("`dismissedFindings`");
      for (const kind of KNOWN_FINDING_KINDS) {
        expect(systemPrompt).toContain(`\`${kind}\``);
      }
      expect(systemPrompt).toMatch(/re-deriv|re-report/i);
    });
  });

  describe("suggestion budget", () => {
    // Cycle-independent now. When it started at cycle 2, cycle 1 looped on nits
    // by design, so no run ever finished in one cycle.
    it("keeps Suggestion-level findings out of the loop on every cycle", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("### Suggestion Budget");
      expect(systemPrompt).toMatch(/on \*\*any\*\* cycle|any cycle/i);
      expect(systemPrompt).not.toMatch(/cycle 2 onward/i);
      // The reason has to be in the prompt: fixes widen the diff, which grows
      // the next review's surface.
      expect(systemPrompt).toMatch(/widen/i);
    });

    // The carve-out for coverage sat outside the budget with no scope, and every
    // fix a cycle lands is "changed code" — so the run's own fix supplied the next
    // cycle's Should-Fix and no branch could ever be done. Observed: cycle 2
    // looped solely for an untested NaN guard that cycle 1's fix had introduced.
    it("scopes the coverage carve-out so a cycle's own fix cannot re-trigger it", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toMatch(/test coverage[^.\n]*\b(contract|reach)/i);
      expect(systemPrompt).toMatch(/defensive guard/i);
      // The reason belongs in the prompt, not only in this test.
      expect(systemPrompt).toMatch(/guarantee[sd]? (one more|another) cycle/i);
    });
  });

  describe("repositories", () => {
    it("lists the repositories and carries a finished one's reports from its cycle", () => {
      const prompt = buildAutonomousGatePrompt({
        ...baseInput,
        loopIteration: 2,
        repositories: [
          { repoName: "repo-a" },
          {
            repoName: "repo-b",
            finished: {
              cycle: 1,
              files: [{ name: "VERIFY-README-owner_repo-b.md", content: "criterion 2: SATISFIED" }],
            },
          },
        ],
      });
      expect(prompt).toContain("## Repositories");
      expect(prompt).toContain("`repo-a`");
      expect(prompt).toMatch(/`repo-b` — finished in cycle 1/);
      expect(prompt).toContain("## Reports of Finished Repositories");
      expect(prompt).toContain("criterion 2: SATISFIED");
    });

    it("adds neither section when no repositories are given", () => {
      const prompt = buildAutonomousGatePrompt(baseInput);
      expect(prompt).not.toContain("## Repositories");
      expect(prompt).not.toContain("## Reports of Finished Repositories");
    });
  });

  describe("completion bar", () => {
    it("makes a PR conditional on the work actually being finished", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("### Completion Bar");
      expect(systemPrompt).toMatch(/what creates every repository's PR/);
      // All four conditions, contiguously numbered — a dropped one is a PR
      // opened over unfinished work.
      const bar = systemPrompt.slice(systemPrompt.indexOf("### Completion Bar"));
      const numbers = [...bar.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])).slice(0, 4);
      expect(numbers).toEqual([1, 2, 3, 4]);
      expect(systemPrompt).toMatch(/`\[~\]`/);
    });
  });
});
