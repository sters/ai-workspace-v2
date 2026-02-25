import { describe, expect, it } from "vitest";
import { buildInitPrompt } from "@/lib/chat-prompt";

describe("buildInitPrompt", () => {
  it("includes the workspace ID", () => {
    const prompt = buildInitPrompt("my-project", "/root/workspace/my-project");
    expect(prompt).toContain('"my-project"');
  });

  it("includes the workspace directory path", () => {
    const prompt = buildInitPrompt("my-project", "/root/workspace/my-project");
    expect(prompt).toContain("/root/workspace/my-project");
  });

  it("instructs to read README.md", () => {
    const prompt = buildInitPrompt("my-project", "/root/workspace/my-project");
    expect(prompt).toContain("README.md");
  });

  it("mentions TODO files and review artifacts", () => {
    const prompt = buildInitPrompt("my-project", "/root/workspace/my-project");
    expect(prompt).toContain("TODO");
    expect(prompt).toContain("review");
  });

  it("does not include the ai-workspace root path as a separate instruction", () => {
    const prompt = buildInitPrompt("my-project", "/root/workspace/my-project");
    expect(prompt).not.toMatch(/ai-workspace root is/i);
  });
});
