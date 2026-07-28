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
import { getCollectorSystemPrompt } from "@/lib/templates/prompts/collector";
import { getCoordinatorSystemPrompt } from "@/lib/templates/prompts/coordinator";

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
  };
  const noCdPrompts: Record<string, string> = {
    collector: getCollectorSystemPrompt(),
    coordinator: getCoordinatorSystemPrompt(),
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
  it("calibrates length without inviting padding", () => {
    expect(WRITTEN_DELIVERABLE_LENGTH.toLowerCase()).toMatch(/length/);
    expect(WRITTEN_DELIVERABLE_LENGTH.toLowerCase()).toMatch(/pad|filler/);
  });

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
  };

  it.each(Object.entries(reportWriters))(
    "%s calibrates the length of the file it writes",
    (_name, prompt) => {
      expect(prompt).toContain(WRITTEN_DELIVERABLE_LENGTH);
    },
  );
});

describe("REPO_SEARCH_EFFICIENCY", () => {
  it("points exploration at the search tools rather than shell navigation", () => {
    expect(REPO_SEARCH_EFFICIENCY).toMatch(/Grep/);
    expect(REPO_SEARCH_EFFICIENCY).toMatch(/Glob/);
  });

  it("asks for independent lookups to be batched into one message", () => {
    expect(REPO_SEARCH_EFFICIENCY.toLowerCase()).toMatch(/single message|one message/);
    expect(REPO_SEARCH_EFFICIENCY.toLowerCase()).toMatch(/round-trip|round trip/);
  });

  it("is applied to the planner, whose exploration is otherwise fully serial", () => {
    expect(getPlannerSystemPrompt()).toContain(REPO_SEARCH_EFFICIENCY);
  });

  it("does not contradict the worktree cd rule it travels with", () => {
    // The cd rule establishes `cd` as how you enter the repo; this fragment must
    // narrow that to shell commands, not forbid cd outright (that is NO_CD_RULES).
    expect(REPO_SEARCH_EFFICIENCY).not.toContain("NEVER use `cd` in Bash commands");
  });
});

describe("SUBAGENT_DELEGATION_POLICY", () => {
  it("caps delegation and forbids self-verification subagents", () => {
    expect(SUBAGENT_DELEGATION_POLICY.toLowerCase()).toMatch(/subagent/);
    expect(SUBAGENT_DELEGATION_POLICY.toLowerCase()).toMatch(/verify|double-check/);
  });

  const delegators: Record<string, string> = {
    executor: getExecutorSystemPrompt(),
    planner: getPlannerSystemPrompt(),
    codeReviewer: getCodeReviewerSystemPrompt(),
    coordinator: getCoordinatorSystemPrompt(),
  };

  it.each(Object.entries(delegators))(
    "%s states when delegation is warranted",
    (_name, prompt) => {
      expect(prompt).toContain(SUBAGENT_DELEGATION_POLICY);
    },
  );
});

describe("SCOPE_DISCIPLINE", () => {
  it("asks for the requested scope, neither narrowed nor widened", () => {
    expect(SCOPE_DISCIPLINE.toLowerCase()).toMatch(/scope/);
    expect(SCOPE_DISCIPLINE.toLowerCase()).toMatch(/narrow|widen/);
  });

  it("is applied to the executor", () => {
    expect(getExecutorSystemPrompt()).toContain(SCOPE_DISCIPLINE);
  });
});

describe("REVIEW_COVERAGE_POLICY", () => {
  it("asks for coverage and defers filtering to a later stage", () => {
    expect(REVIEW_COVERAGE_POLICY).toMatch(/every issue|all issues/i);
    expect(REVIEW_COVERAGE_POLICY.toLowerCase()).toMatch(/do not filter|not filter/);
    expect(REVIEW_COVERAGE_POLICY).toMatch(/Confidence/);
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
