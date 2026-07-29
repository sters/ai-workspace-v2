import { describe, expect, it } from "vitest";
import {
  buildAutonomousGatePrompt,
  getAutonomousGateSystemPrompt,
  AUTONOMOUS_GATE_SCHEMA,
} from "@/lib/templates/prompts/autonomous-gate";
import { KNOWN_FINDING_KINDS } from "@/lib/workspace/known-findings";

describe("AUTONOMOUS_GATE_SCHEMA", () => {
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
    expect(prompt).toMatch(/without creating a PR/i);
    expect(prompt).toMatch(/`shouldLoop: true`/);
    expect(prompt).not.toMatch(/MUST set `shouldLoop: false`/);
  });

  it("does not add the final-cycle note when below max loops", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).not.toContain("FINAL cycle");
  });

  it("instructs to evaluate all severity levels including warnings and suggestions", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("warnings");
    expect(systemPrompt).toContain("suggestions");
    expect(systemPrompt).toContain("every severity level");
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

  // The cycles exist to finish the run's own work, not to pre-empt opinions a
  // future reviewer might hold — that framing turns polish into a loop reason.
  it("does not define the bar as a future reviewer's reaction", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).not.toMatch(/human reviewer would/i);
    expect(systemPrompt).not.toMatch(/block a merge/i);
  });

  it("splits the examples into loop-worthy and deferred, with nits on the deferred side", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    const loopExamples = systemPrompt.slice(
      systemPrompt.indexOf("do** justify a loop"),
      systemPrompt.indexOf("**defer** rather than loop"),
    );
    const deferExamples = systemPrompt.slice(
      systemPrompt.indexOf("**defer** rather than loop"),
    );
    expect(loopExamples).toMatch(/test coverage/i);
    expect(loopExamples).toMatch(/lint|test|build/i);
    expect(deferExamples).toContain("Typos");
    expect(deferExamples).toContain("struct/type layout");
  });

  it("marks the loop-trigger examples as non-exhaustive", () => {
    // Claude follows enumerations literally, so an unlabelled list reads as closed.
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toMatch(/not an exhaustive list|illustrative/i);
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

  it("treats low-confidence findings as insufficient grounds for a loop", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("### Confidence Filtering");
    expect(systemPrompt).toMatch(/low confidence.*does NOT by itself justify a loop/is);
    expect(systemPrompt).toMatch(/no annotation.*treat as medium/is);
    expect(systemPrompt).toMatch(/coverage over filtering/i);
  });

  it("includes give-up instructions for stagnation detection", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("giveUp");
    expect(systemPrompt).toContain("stagnation");
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

    it("stops treating an infeasible (auto) criterion as an actionable gate", () => {
      // Otherwise the README verifier's permanent UNSATISFIED keeps the loop
      // running toward a target the feasibility check already ruled out.
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toMatch(/`infeasible`/);
      expect(systemPrompt).toMatch(/not\*{0,2} addressable by changing code/);
      expect(systemPrompt).toMatch(/does NOT justify a loop/);
    });

    it("forbids looping on an already-accepted finding, with a materially-changed escape", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("### Known / Accepted Findings");
      expect(systemPrompt).toMatch(/does not justify `shouldLoop: true`/);
      expect(systemPrompt).toMatch(/materially changed/i);
      // The actual convergence rule: recurring-only review means proceed.
      expect(systemPrompt).toMatch(/only recurring findings/i);
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

    it("keeps looped-on findings out of dismissedFindings", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toMatch(/Do NOT put in `dismissedFindings`/);
      expect(systemPrompt).toContain("`fixableIssues`");
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

    // The budget must not become a licence to file a real defect as a Suggestion:
    // the loop bar is only safe if the severity labels mean what they say.
    it("forbids down-labelling a merge-blocking finding to dodge the loop", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toMatch(/down-label/i);
      expect(systemPrompt).toMatch(/test coverage for changed code is Should-Fix/i);
    });

    // The gate cannot see the cycle number from its system prompt, and the rule
    // no longer depends on it, so there is nothing to restate per cycle.
    it("needs no per-cycle restatement in the user prompt", () => {
      expect(buildAutonomousGatePrompt(baseInput)).not.toContain("Suggestion Budget");
      expect(buildAutonomousGatePrompt({ ...baseInput, loopIteration: 2 })).not.toContain(
        "Suggestion Budget",
      );
    });

    it("records deferred suggestions rather than promising them to the PR body", () => {
      // Nothing carries them into the PR description — create-pr never reads the
      // review or the gate's output — so the prompt must not claim it does.
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).not.toMatch(/carried to the PR description/i);
      expect(systemPrompt).toMatch(/`deferred`/);
    });
  });

  describe("completion bar", () => {
    it("makes a PR conditional on the work actually being finished", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("### Completion Bar");
      expect(systemPrompt).toMatch(/pending|\[ \]/);
      expect(systemPrompt).toMatch(/`\[~\]`/);
      expect(systemPrompt).toMatch(/PR/);
    });

    it("keeps a human-blocked TODO item from blocking the PR forever", () => {
      // `[!]` items are excluded from execute batching, so treating them as
      // blocking work would make every such run end without a PR.
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toMatch(/`\[!\]`/);
      expect(systemPrompt).toMatch(/pending-human/);
    });
  });

  describe("final cycle", () => {
    it("explains that shouldLoop stops the run when no cycle is left", () => {
      const systemPrompt = getAutonomousGateSystemPrompt();
      expect(systemPrompt).toContain("### The Final Cycle");
      expect(systemPrompt).toMatch(/stops the run \*\*without creating a PR\*\*/);
      // Both failure directions matter: a soft "done" ships leftovers, and
      // invented remaining work throws away a finished branch.
      expect(systemPrompt).toMatch(/do not soften/i);
      expect(systemPrompt).toMatch(/do not invent/i);
    });
  });
});

describe("getAutonomousGateSystemPrompt — requested-fix verification", () => {
  const prompt = getAutonomousGateSystemPrompt();

  it("names the fix-verification report as the authority on whether an ask landed", () => {
    expect(prompt).toContain("NOT LANDED");
    expect(prompt).toContain("PARTIAL");
  });

  // The whole reason the verifier exists: the audit's TODO cross-reference reads
  // what the executor claimed, and a `[x]` on unlanded work ends the run early.
  it("prefers the verifier's verdict over the TODO checkbox when they disagree", () => {
    expect(prompt).toMatch(/VERIFY-FIXES|fix verification/i);
    expect(prompt.toLowerCase()).toMatch(/disagree|conflict|over the todo|rather than the todo/);
  });

  it("makes an unlanded ask a loop reason", () => {
    const bullet = prompt
      .split("\n")
      .find((l) => l.includes("NOT LANDED") && l.includes("shouldLoop"));
    expect(bullet, "no line ties NOT LANDED to shouldLoop").toBeDefined();
    expect(bullet).toContain("shouldLoop: true");
  });

  // The Suggestion Budget narrows what *new* findings may loop from cycle 2 on.
  // Applying it to already-requested work would let an ask be dropped by the
  // cycle counter alone.
  it("exempts already-requested work from the Suggestion Budget", () => {
    expect(prompt).toMatch(/Suggestion Budget governs \*new\* findings/);
  });

  // Otherwise a bogus ask loops forever: the gate wrote it, so only the gate can
  // retire it, and it needs the recorded reason to do that.
  it("lets the gate retire an ask it now judges wrong instead of looping on it", () => {
    expect(prompt.toLowerCase()).toMatch(/dismissedfindings|retire|withdraw/);
  });
});
