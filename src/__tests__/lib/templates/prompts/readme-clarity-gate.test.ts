import { describe, expect, it } from "vitest";
import {
  getReadmeClarityGateSystemPrompt,
  buildReadmeClarityGatePrompt,
  README_CLARITY_GATE_SCHEMA,
} from "@/lib/templates/prompts/readme-clarity-gate";

describe("readme-clarity-gate prompt", () => {
  it("system prompt frames it as a safety valve, not a quality bar", () => {
    const sys = getReadmeClarityGateSystemPrompt();
    expect(sys).toContain("safety valve");
    expect(sys).toMatch(/sufficient/);
    // Biases toward proceeding on normal tasks.
    expect(sys.toLowerCase()).toContain("bias toward");
  });

  it("embeds README content and the parsed acceptance criteria", () => {
    const prompt = buildReadmeClarityGatePrompt({
      workspaceName: "ws-1",
      readmeContent: "## Goal\n\nDo the thing",
      acceptanceCriteria: "- [ ] (auto) tests pass",
    });
    expect(prompt).toContain("ws-1");
    expect(prompt).toContain("Do the thing");
    expect(prompt).toContain("Acceptance Criteria (parsed)");
    expect(prompt).toContain("- [ ] (auto) tests pass");
  });

  it("omits the parsed AC section when there are none", () => {
    const prompt = buildReadmeClarityGatePrompt({
      workspaceName: "ws-1",
      readmeContent: "## Goal\n\nDo the thing",
    });
    expect(prompt).not.toContain("Acceptance Criteria (parsed)");
  });

  it("schema requires sufficient/reason/missing", () => {
    expect(README_CLARITY_GATE_SCHEMA.required).toEqual(["sufficient", "reason", "missing"]);
  });
});
