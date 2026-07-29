import { describe, expect, it } from "vitest";
import { getWorkspaceSuggesterSystemPrompt } from "@/lib/templates/prompts/workspace-suggester";

describe("workspace-suggester prompt", () => {
  // The suggester's whole job is separating incidental out-of-scope observations
  // from the workspace's own work.
  it("scopes suggestions to out-of-scope, incidental findings", () => {
    const systemPrompt = getWorkspaceSuggesterSystemPrompt();
    expect(systemPrompt).toContain("out of scope");
    expect(systemPrompt).toContain("incidental");
  });
});
