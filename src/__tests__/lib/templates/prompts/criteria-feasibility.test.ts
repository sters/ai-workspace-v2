import {
  buildCriteriaFeasibilityPrompt,
} from "@/lib/templates/prompts/criteria-feasibility";
import type { CriteriaFeasibilityInput } from "@/types/prompts";

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

  it("omits the parsed-criteria section when there are none", () => {
    const prompt = buildCriteriaFeasibilityPrompt({
      ...baseInput,
      acceptanceCriteria: "",
    });
    expect(prompt).not.toContain("Acceptance Criteria (parsed)");
  });
});
