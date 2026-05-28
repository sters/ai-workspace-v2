import { describe, it, expect } from "vitest";
import { buildReadmeUpdaterPrompt, getReadmeUpdaterSystemPrompt } from "@/lib/templates/prompts/readme-updater";
import type { ReadmeUpdaterInput } from "@/types/prompts";

function baseInput(): ReadmeUpdaterInput {
  return {
    workspaceName: "demo",
    readmeContent: "# Task: ...",
    workspacePath: "/ws/demo",
    instruction: "add a Risks section",
  };
}

describe("getReadmeUpdaterSystemPrompt", () => {
  it("constrains edits to README.md", () => {
    const sys = getReadmeUpdaterSystemPrompt();
    expect(sys).toMatch(/README\.md/);
    expect(sys).toMatch(/only|restrict/i);
  });
});

describe("buildReadmeUpdaterPrompt", () => {
  it("includes the instruction and current README content", () => {
    const prompt = buildReadmeUpdaterPrompt(baseInput());
    expect(prompt).toContain("add a Risks section");
    expect(prompt).toContain("# Task: ...");
    expect(prompt).toContain("/ws/demo/README.md");
  });

  it("omits the interjection notice by default", () => {
    const prompt = buildReadmeUpdaterPrompt(baseInput());
    expect(prompt).not.toContain("Interjection Notice");
  });

  it("includes the interjection notice when interject is true", () => {
    const prompt = buildReadmeUpdaterPrompt({ ...baseInput(), interject: true });
    expect(prompt).toContain("## Interjection Notice");
    expect(prompt).toContain("mid-flight");
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
