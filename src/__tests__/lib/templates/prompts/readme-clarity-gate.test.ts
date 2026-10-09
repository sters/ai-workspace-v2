import { describe, expect, it } from "vitest";
import {
  buildReadmeClarityGatePrompt,
} from "@/lib/templates/prompts/readme-clarity-gate";

describe("readme-clarity-gate prompt", () => {
  it("omits the parsed AC section when there are none", () => {
    const prompt = buildReadmeClarityGatePrompt({
      workspaceName: "ws-1",
      readmeContent: "## Goal\n\nDo the thing",
    });
    expect(prompt).not.toContain("Acceptance Criteria (parsed)");
  });
});
