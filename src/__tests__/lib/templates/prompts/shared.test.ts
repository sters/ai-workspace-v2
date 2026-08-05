import {
  NO_CD_RULES,
  RECURRING_FINDINGS_POLICY,
  REPO_SEARCH_EFFICIENCY,
  REVIEW_COVERAGE_POLICY,
  SCOPE_DISCIPLINE,
  SEVERITY_CALIBRATION,
  SUBAGENT_DELEGATION_POLICY,
  WRITTEN_DELIVERABLE_LENGTH,
  worktreeCdRules,
} from "@/lib/templates/prompts/shared";
import { getExecutorSystemPrompt } from "@/lib/templates/prompts/executor";
import { getPlannerSystemPrompt, getResearchPlannerSystemPrompt } from "@/lib/templates/prompts/planner";
import { getReviewerSystemPrompt } from "@/lib/templates/prompts/reviewer";
import { getCodeReviewerSystemPrompt } from "@/lib/templates/prompts/code-reviewer";
import { getCrossRepositoryReviewerSystemPrompt } from "@/lib/templates/prompts/cross-repository-reviewer";
import { getTodoVerifierSystemPrompt } from "@/lib/templates/prompts/todo-verifier";
import { getReadmeVerifierSystemPrompt } from "@/lib/templates/prompts/readme-verifier";
import { getPRCreatorSystemPrompt } from "@/lib/templates/prompts/pr-creator";
import { getPrCommentValidatorSystemPrompt } from "@/lib/templates/prompts/pr-comment-validator";
import { getCollectorSystemPrompt } from "@/lib/templates/prompts/collector";
import { getCoordinatorSystemPrompt } from "@/lib/templates/prompts/coordinator";
import { getUpdaterSystemPrompt } from "@/lib/templates/prompts/updater";
import {
  getResearchFindingsRepoSystemPrompt,
  getResearchFindingsCrossRepoSystemPrompt,
  getResearchRecommendationsSystemPrompt,
  getResearchIntegrationSystemPrompt,
} from "@/lib/templates/prompts/researcher";

const researchPrompts: Record<string, string> = {
  researchFindingsRepo: getResearchFindingsRepoSystemPrompt(),
  researchFindingsCrossRepo: getResearchFindingsCrossRepoSystemPrompt(),
  researchRecommendations: getResearchRecommendationsSystemPrompt(),
  researchIntegration: getResearchIntegrationSystemPrompt(),
};

describe("worktreeCdRules", () => {
  it("requires a bare cd as the first Bash call", () => {
    const rules = worktreeCdRules({ examples: "`git status`, etc." });
    expect(rules).toContain("### Working Directory");
    expect(rules).toMatch(/first Bash tool call MUST be `cd` alone/);
    expect(rules).toMatch(/Do NOT combine `cd`/);
    expect(rules).toContain("`git status`, etc.");
    expect(rules).toContain("Do NOT use `git -C`");
  });

  it("accepts extra forbidden prefix-flag forms", () => {
    const rules = worktreeCdRules({
      examples: "`make lint`",
      forbidden: "`git -C` or `make -C`",
    });
    expect(rules).toContain("Do NOT use `git -C` or `make -C`");
  });

  it("appends an extra paragraph when given", () => {
    const rules = worktreeCdRules({ examples: "`git diff`", extra: "Extra note here." });
    expect(rules.endsWith("Extra note here.")).toBe(true);
  });
});

describe("working-directory conventions", () => {
  const cdPrompts: Record<string, string> = {
    executor: getExecutorSystemPrompt(),
    planner: getPlannerSystemPrompt(),
    researchPlanner: getResearchPlannerSystemPrompt(),
    reviewer: getReviewerSystemPrompt(),
    codeReviewer: getCodeReviewerSystemPrompt(),
    todoVerifier: getTodoVerifierSystemPrompt(),
    readmeVerifier: getReadmeVerifierSystemPrompt(),
    prCreator: getPRCreatorSystemPrompt(),
    prCommentValidator: getPrCommentValidatorSystemPrompt(),
  };
  const noCdPrompts: Record<string, string> = {
    collector: getCollectorSystemPrompt(),
    coordinator: getCoordinatorSystemPrompt(),
    ...researchPrompts,
  };

  it.each(Object.entries(cdPrompts))(
    "%s carries the canonical worktree cd rule",
    (_name, prompt) => {
      expect(prompt).toMatch(/first Bash tool call MUST be `cd` alone/);
    },
  );

  it.each(Object.entries(noCdPrompts))(
    "%s carries the canonical no-cd rule",
    (_name, prompt) => {
      expect(prompt).toContain(NO_CD_RULES);
    },
  );

  it("never mixes the two conventions in one prompt", () => {
    for (const [name, prompt] of Object.entries({ ...cdPrompts, ...noCdPrompts })) {
      const requiresCd = /first Bash tool call MUST be `cd` alone/.test(prompt);
      const forbidsCd = prompt.includes("NEVER use `cd` in Bash commands");
      expect(requiresCd && forbidsCd, `${name} states both conventions`).toBe(false);
    }
  });
});

describe("WRITTEN_DELIVERABLE_LENGTH", () => {
  const reportWriters: Record<string, string> = {
    codeReviewer: getCodeReviewerSystemPrompt(),
    crossRepositoryReviewer: getCrossRepositoryReviewerSystemPrompt(),
    readmeVerifier: getReadmeVerifierSystemPrompt(),
    todoVerifier: getTodoVerifierSystemPrompt(),
    collector: getCollectorSystemPrompt(),
    // The TODO file is the most re-embedded deliverable in the pipeline: the
    // executor re-reads it once per batch, the verifier audits it, and the
    // autonomous gate reads every one of them each cycle.
    planner: getPlannerSystemPrompt(),
    ...researchPrompts,
  };

  it.each(Object.entries(reportWriters))(
    "%s calibrates the length of the file it writes",
    (_name, prompt) => {
      expect(prompt).toContain(WRITTEN_DELIVERABLE_LENGTH);
    },
  );
});

describe("REPO_SEARCH_EFFICIENCY", () => {
  it("is applied to the planner, whose exploration is otherwise fully serial", () => {
    expect(getPlannerSystemPrompt()).toContain(REPO_SEARCH_EFFICIENCY);
  });

  it("is applied to the PR comment validator, which explores to check one claim", () => {
    expect(getPrCommentValidatorSystemPrompt()).toContain(REPO_SEARCH_EFFICIENCY);
  });

  it("does not contradict the worktree cd rule it travels with", () => {
    // The cd rule establishes `cd` as how you enter the repo; this fragment must
    // narrow that to shell commands, not forbid cd outright (that is NO_CD_RULES).
    expect(REPO_SEARCH_EFFICIENCY).not.toContain("NEVER use `cd` in Bash commands");
  });

  // The measured failure was not a missing rule. The agent batched its lookups
  // into one Bash string (26 of 54 calls used `;`) while taking exactly one tool
  // call per turn, 73 turns running — it read "one message" as "one command".
  it("names the unit as tool calls in a turn, not a message", () => {
    expect(REPO_SEARCH_EFFICIENCY).toContain("several tool calls in a single turn");
    expect(REPO_SEARCH_EFFICIENCY).not.toContain("in a single message");
  });

  it("rules out packing lookups into one shell command", () => {
    expect(REPO_SEARCH_EFFICIENCY).toMatch(/is \*\*not\*\* the same thing/);
  });

  it("shows the wanted turn shape rather than only describing it", () => {
    // A positive example of the wanted behavior, per CLAUDE.md's prompt
    // conventions — the old version was rationale competing with a MUST.
    expect(REPO_SEARCH_EFFICIENCY).toMatch(/```\n(Grep|Glob|Read)/);
  });

  it.each(["sed", "head", "awk", "wc", "find", "cat"])(
    "covers the %s idiom the transcript actually used",
    (cmd) => {
      expect(REPO_SEARCH_EFFICIENCY).toContain(cmd);
    },
  );

  it("marks its shell-to-tool table non-exhaustive", () => {
    // Claude reads enumerations literally: the closed list `grep`/`find`/`ls`/`cat`
    // left `sed -n 'X,Yp'` feeling permitted, and it became the most used call.
    expect(REPO_SEARCH_EFFICIENCY).toContain("non-exhaustive");
  });

  it("gives a large file an answer other than the shell", () => {
    expect(REPO_SEARCH_EFFICIENCY).toMatch(/`offset` and `limit`/);
  });

  it("renders after the cd rule in the planner, not before it", () => {
    // Emphasis and position: the cd rule opens with an all-caps MUST about a Bash
    // call, so whichever comes second gets the last word on how to touch the repo.
    const prompt = getPlannerSystemPrompt();
    expect(prompt.indexOf("### Working Directory")).toBeLessThan(
      prompt.indexOf("### Searching the Repository"),
    );
  });
});

describe("SUBAGENT_DELEGATION_POLICY", () => {
  const delegators: Record<string, string> = {
    executor: getExecutorSystemPrompt(),
    planner: getPlannerSystemPrompt(),
    codeReviewer: getCodeReviewerSystemPrompt(),
    coordinator: getCoordinatorSystemPrompt(),
    ...researchPrompts,
  };

  it.each(Object.entries(delegators))(
    "%s states when delegation is warranted",
    (_name, prompt) => {
      expect(prompt).toContain(SUBAGENT_DELEGATION_POLICY);
    },
  );
});

describe("SCOPE_DISCIPLINE", () => {
  it("is applied to the executor", () => {
    expect(getExecutorSystemPrompt()).toContain(SCOPE_DISCIPLINE);
  });

  // The updater is the other place a request's scope can grow, because it is what
  // turns a gate's numbered asks into the items an executor works from. On the run
  // this was written for, an ask for two SWR options became a TODO prescribing the
  // neighbouring hook's seven, and undoing the five nobody asked for is what the
  // final cycle spent its loop on.
  it("is applied to the TODO updater", () => {
    expect(getUpdaterSystemPrompt()).toContain(SCOPE_DISCIPLINE);
  });

  // Citing a neighbour is where that widening came from: the five extra options
  // were in the pattern, not in the request. So the rule has to name the pattern
  // itself, not just "don't widen" in the abstract.
  it("limits an existing pattern to the form of the change, not its extent", () => {
    expect(SCOPE_DISCIPLINE).toMatch(/form, not extent/i);
    expect(SCOPE_DISCIPLINE).toMatch(/only the surface the request names/i);
  });
});

describe("REVIEW_COVERAGE_POLICY", () => {
  it("asks for coverage and defers filtering to a later stage", () => {
    expect(REVIEW_COVERAGE_POLICY).toMatch(/every issue|all issues/i);
    expect(REVIEW_COVERAGE_POLICY.toLowerCase()).toMatch(/do not filter|not filter/);
    expect(REVIEW_COVERAGE_POLICY).toMatch(/Confidence/);
  });

  // Confidence is the one field with a hard "does not justify a loop" rule
  // attached downstream, so it must measure exactly one thing. A reviewer that
  // routed "I verified the mechanism but cannot confirm the input occurs" into a
  // low confidence got a verified regression dropped by the gate.
  it("scopes confidence to the mechanism, not the likelihood of the input", () => {
    expect(REVIEW_COVERAGE_POLICY).toMatch(/mechanism/i);
    expect(REVIEW_COVERAGE_POLICY).toMatch(/does not lower|not lowered/i);
    expect(REVIEW_COVERAGE_POLICY).toMatch(/state (it|the unconfirmed)/i);
  });

  // A "no blocking issues / merge-ready" line is itself filtering, and it is the
  // one form of it the report template used to invite. The gate is told the review
  // does not filter, so the two ends disagreed about the same file.
  it("withholds the ship/no-ship verdict from the reviewer", () => {
    expect(REVIEW_COVERAGE_POLICY).toMatch(/merge-ready|ready to ship|no blocking/i);
    expect(REVIEW_COVERAGE_POLICY).toMatch(/do not (state|write|declare)/i);
  });

  it.each([
    ["codeReviewer", getCodeReviewerSystemPrompt()],
    ["crossRepositoryReviewer", getCrossRepositoryReviewerSystemPrompt()],
  ])("%s prioritizes coverage over self-filtering", (_name, prompt) => {
    expect(prompt).toContain(REVIEW_COVERAGE_POLICY);
  });
});

describe("SEVERITY_CALIBRATION", () => {
  // The autonomous gate now loops only on Critical/Warning-level findings, so the
  // severity label is load-bearing: a real defect filed as a Suggestion is a
  // defect the run will never come back to.
  it("anchors severity to whether the change is done and sound", () => {
    expect(SEVERITY_CALIBRATION).toMatch(/complete|incomplete/i);
    expect(SEVERITY_CALIBRATION).toMatch(/Suggestion/);
    expect(SEVERITY_CALIBRATION).toMatch(/test coverage/i);
  });

  // Every fix a cycle lands is itself "changed behavior", so an unscoped coverage
  // Warning has no fixed point: each cycle's own fix supplies the next cycle's
  // finding. The scope has to be the contract or a reachable path.
  it("scopes the coverage warning to contract-required or reachable behavior", () => {
    expect(SEVERITY_CALIBRATION).toMatch(/test coverage[^.\n]*\b(contract|reach)/i);
    // ...and names the counter-case on the Suggestion side, or the scoping is
    // advice with no consequence attached.
    expect(SEVERITY_CALIBRATION).toMatch(/defensive guard/i);
  });

  // "This change handles less than the code it replaced" is a diff-level fact,
  // checkable without knowing production data — so it must not depend on knowing
  // whether the dropped input occurs. Bounded to the replaced code, so it cannot
  // fire on pre-existing defects or on speculation about future inputs.
  it("treats a capability the replaced code had as a Warning", () => {
    expect(SEVERITY_CALIBRATION).toMatch(/replace[ds]?\b/i);
    expect(SEVERITY_CALIBRATION).toMatch(/input/i);
    const warnings = SEVERITY_CALIBRATION.slice(
      SEVERITY_CALIBRATION.indexOf("**Warnings**"),
      SEVERITY_CALIBRATION.indexOf("**Suggestions**"),
    );
    expect(warnings).toMatch(/replace/i);
  });

  // The mirror of the replaced-capability rule: a construct copied from a
  // neighbouring call site is new code, but the defect in it belongs to the
  // repository's convention, not to this change. On the run this was written for,
  // an option block copied from a sibling hook (five other pre-existing sites had
  // it verbatim) became the high-confidence Warning that spent the final cycle and
  // cost the run its PR.
  it("treats a construct copied from pre-existing sites as a repo-level Suggestion", () => {
    expect(SEVERITY_CALIBRATION).toMatch(/new but not novel/i);
    expect(SEVERITY_CALIBRATION).toMatch(/pre-existing sites/i);
    // Inert unless the reviewer is told to go look for the other sites.
    expect(SEVERITY_CALIBRATION).toMatch(/check whether it already exists/i);
    // Coverage is untouched — it is filed lower, not dropped.
    expect(SEVERITY_CALIBRATION).toMatch(/report it with the sites/i);
  });

  // Severity must describe the deliverable, not predict a future reader.
  it("does not anchor severity to a hypothetical reviewer's reaction", () => {
    expect(SEVERITY_CALIBRATION).not.toMatch(/human reviewer/i);
    expect(SEVERITY_CALIBRATION).not.toMatch(/before merg/i);
  });

  it.each([
    ["codeReviewer", getCodeReviewerSystemPrompt()],
    ["crossRepositoryReviewer", getCrossRepositoryReviewerSystemPrompt()],
  ])("%s carries the severity calibration alongside coverage", (_name, prompt) => {
    expect(prompt).toContain(SEVERITY_CALIBRATION);
    expect(prompt).toContain(REVIEW_COVERAGE_POLICY);
  });
});

describe("RECURRING_FINDINGS_POLICY", () => {
  it("compresses recurrences instead of suppressing them", () => {
    expect(RECURRING_FINDINGS_POLICY).toContain("Known / Accepted Findings");
    expect(RECURRING_FINDINGS_POLICY).toContain("(Recurring)");
    // Coverage must survive: the finding is still reported, just not re-argued.
    expect(RECURRING_FINDINGS_POLICY).toMatch(/report it/i);
    expect(RECURRING_FINDINGS_POLICY).toMatch(/one line/i);
  });

  it("keeps a merely similar or materially changed finding out of the compressed bucket", () => {
    expect(RECURRING_FINDINGS_POLICY).toMatch(/resembles/i);
    expect(RECURRING_FINDINGS_POLICY).toMatch(/materially changed/i);
  });

  it.each([
    ["codeReviewer", getCodeReviewerSystemPrompt()],
    ["crossRepositoryReviewer", getCrossRepositoryReviewerSystemPrompt()],
  ])("%s carries the recurring-findings policy alongside coverage", (_name, prompt) => {
    expect(prompt).toContain(RECURRING_FINDINGS_POLICY);
    expect(prompt).toContain(REVIEW_COVERAGE_POLICY);
  });
});
