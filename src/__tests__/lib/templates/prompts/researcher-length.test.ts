import {
  getResearchFindingsRepoSystemPrompt,
  getResearchFindingsCrossRepoSystemPrompt,
  getResearchRecommendationsSystemPrompt,
  getResearchIntegrationSystemPrompt,
} from "@/lib/templates/prompts/researcher";
import {
  NO_CD_RULES,
  SUBAGENT_DELEGATION_POLICY,
  WRITTEN_DELIVERABLE_LENGTH,
} from "@/lib/templates/prompts/shared";

const prompts: Record<string, string> = {
  findingsRepo: getResearchFindingsRepoSystemPrompt(),
  findingsCrossRepo: getResearchFindingsCrossRepoSystemPrompt(),
  recommendations: getResearchRecommendationsSystemPrompt(),
  integration: getResearchIntegrationSystemPrompt(),
};

describe("research prompts", () => {
  it.each(Object.entries(prompts))(
    "%s calibrates the length of the reports it writes",
    (_name, prompt) => {
      expect(prompt).toContain(WRITTEN_DELIVERABLE_LENGTH);
    },
  );

  it.each(Object.entries(prompts))(
    "%s states when delegation is warranted",
    (_name, prompt) => {
      expect(prompt).toContain(SUBAGENT_DELEGATION_POLICY);
    },
  );

  it.each(Object.entries(prompts))(
    "%s uses the canonical no-cd working-directory rule",
    (_name, prompt) => {
      expect(prompt).toContain(NO_CD_RULES);
      expect(prompt).not.toMatch(/first Bash tool call MUST be `cd` alone/);
    },
  );
});
