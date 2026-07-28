import {
  CRITERIA_FEASIBILITY_PHASE_LABEL,
  CRITERIA_FEASIBILITY_SCHEMA,
  buildCriteriaFeasibilityPrompt,
  getCriteriaFeasibilitySystemPrompt,
} from "@/lib/templates/prompts/criteria-feasibility";
import { NO_CD_RULES } from "@/lib/templates/prompts/shared";
import type { CriteriaFeasibilityInput } from "@/types/prompts";

describe("CRITERIA_FEASIBILITY_SCHEMA", () => {
  it("requires an infeasible list with a criterion and a concrete reason", () => {
    expect(CRITERIA_FEASIBILITY_SCHEMA.required).toEqual(
      expect.arrayContaining(["infeasible", "reason"]),
    );
    expect(CRITERIA_FEASIBILITY_SCHEMA.properties.infeasible.items.required).toEqual(
      expect.arrayContaining(["criterion", "reason"]),
    );
  });
});

describe("getCriteriaFeasibilitySystemPrompt", () => {
  const prompt = getCriteriaFeasibilitySystemPrompt();

  it("scopes the check to (auto) criteria and leaves (manual) handoffs alone", () => {
    expect(prompt).toMatch(/\(auto\)/);
    expect(prompt).toMatch(/\(manual\)/);
    expect(prompt).toMatch(/human handoff/i);
  });

  it("distinguishes 'outside these repositories' from merely hard work", () => {
    expect(prompt).toMatch(/another team|do not own|outside these repositories/i);
    expect(prompt).toMatch(/merely hard|unstarted|refactor/i);
  });

  it("states the asymmetry that makes a false 'infeasible' the expensive error", () => {
    expect(prompt).toMatch(/when unsure/i);
    expect(prompt).toMatch(/feasible/);
    expect(prompt).toMatch(/empty .*list is the expected/i);
  });

  it("spans repositories, so it carries the no-cd convention", () => {
    expect(prompt).toContain(NO_CD_RULES);
    expect(prompt).not.toMatch(/first Bash tool call MUST be `cd` alone/);
  });
});

describe("buildCriteriaFeasibilityPrompt", () => {
  const baseInput: CriteriaFeasibilityInput = {
    workspaceName: "ws",
    readmeContent: "# Task: something",
    acceptanceCriteria: "- [ ] (auto) Multiple IDs render most-recent-first",
    repos: [
      { repoName: "frontend", worktreePath: "/tmp/frontend" },
      { repoName: "bff", worktreePath: "/tmp/bff" },
    ],
  };

  it("lists every repository worktree so the judge can read both sides", () => {
    const prompt = buildCriteriaFeasibilityPrompt(baseInput);
    expect(prompt).toContain("frontend");
    expect(prompt).toContain("/tmp/frontend");
    expect(prompt).toContain("bff");
    expect(prompt).toContain("/tmp/bff");
  });

  it("includes the README and the parsed criteria", () => {
    const prompt = buildCriteriaFeasibilityPrompt(baseInput);
    expect(prompt).toContain("# Task: something");
    expect(prompt).toContain("Multiple IDs render most-recent-first");
  });

  it("survives a workspace with no repositories on disk", () => {
    const prompt = buildCriteriaFeasibilityPrompt({ ...baseInput, repos: [] });
    expect(prompt).toContain("(no repositories on disk)");
  });

  it("omits the parsed-criteria section when there are none", () => {
    const prompt = buildCriteriaFeasibilityPrompt({
      ...baseInput,
      acceptanceCriteria: "",
    });
    expect(prompt).not.toContain("Acceptance Criteria (parsed)");
  });
});

describe("CRITERIA_FEASIBILITY_PHASE_LABEL", () => {
  it("is a stable label the pipeline and UI share", () => {
    expect(CRITERIA_FEASIBILITY_PHASE_LABEL).toBe("Check criteria feasibility");
  });
});
