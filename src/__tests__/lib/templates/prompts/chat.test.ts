import { describe, expect, it } from "vitest";
import { buildInitPrompt, buildReviewChatPrompt } from "@/lib/templates";

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

describe("buildReviewChatPrompt", () => {
  const workspaceId = "my-project";
  const workspacePath = "/root/workspace/my-project";
  const reviewTimestamp = "20260214-235920";

  it("includes the workspace ID and path", () => {
    const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);
    expect(prompt).toContain('"my-project"');
    expect(prompt).toContain(workspacePath);
  });

  it("includes the review timestamp", () => {
    const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);
    expect(prompt).toContain(reviewTimestamp);
  });

  it("includes the review artifacts path", () => {
    const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);
    expect(prompt).toContain(`artifacts/reviews/${reviewTimestamp}/`);
  });

  it("instructs to read the summary file", () => {
    const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);
    expect(prompt).toContain("SUMMARY.md");
  });
});
