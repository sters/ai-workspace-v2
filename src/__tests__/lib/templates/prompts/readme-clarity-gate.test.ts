import { describe, expect, it } from "vitest";
import {
  getReadmeClarityGateSystemPrompt,
  buildReadmeClarityGatePrompt,
} from "@/lib/templates/prompts/readme-clarity-gate";

describe("readme-clarity-gate prompt", () => {
  it("system prompt frames it as a safety valve, not a quality bar", () => {
    const sys = getReadmeClarityGateSystemPrompt();
    expect(sys).toContain("safety valve");
    expect(sys).toMatch(/sufficient/);
    // Biases toward proceeding on normal tasks.
    expect(sys.toLowerCase()).toContain("bias toward");
  });

  it("omits the parsed AC section when there are none", () => {
    const prompt = buildReadmeClarityGatePrompt({
      workspaceName: "ws-1",
      readmeContent: "## Goal\n\nDo the thing",
    });
    expect(prompt).not.toContain("Acceptance Criteria (parsed)");
  });
});
