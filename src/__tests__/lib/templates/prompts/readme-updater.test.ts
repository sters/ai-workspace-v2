import { describe, it, expect } from "vitest";
import { buildReadmeUpdaterPrompt } from "@/lib/templates/prompts/readme-updater";
import type { ReadmeUpdaterInput } from "@/types/prompts";

function baseInput(): ReadmeUpdaterInput {
  return {
    workspaceName: "demo",
    readmeContent: "# Task: ...",
    workspacePath: "/ws/demo",
    instruction: "add a Risks section",
  };
}

describe("buildReadmeUpdaterPrompt", () => {
  it("omits the interjection notice by default", () => {
    const prompt = buildReadmeUpdaterPrompt(baseInput());
    expect(prompt).not.toContain("Interjection Notice");
  });

  it("places the interjection notice before the Working Directory section", () => {
    const prompt = buildReadmeUpdaterPrompt({ ...baseInput(), interject: true });
    const noticeIdx = prompt.indexOf("Interjection Notice");
    const workdirIdx = prompt.indexOf("Working Directory");
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(workdirIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(workdirIdx);
  });
});
