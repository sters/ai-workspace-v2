import { describe, expect, it } from "vitest";
import {
  getPlannerSystemPrompt,
  getResearchPlannerSystemPrompt,
  buildPlannerPrompt,
} from "@/lib/templates/prompts/planner";

describe("getPlannerSystemPrompt", () => {
  const prompt = getPlannerSystemPrompt();

  it("requires Pattern, Verify, Why fields for code-change items (not optional)", () => {
    // Pattern / Verify / Why must be marked required, not optional
    expect(prompt).toMatch(/Pattern.*\(required/i);
    expect(prompt).toMatch(/Verify.*\(required/i);
    expect(prompt).toMatch(/Why.*\(required/i);
  });

  it("requires path:line or path + symbol/function for Target on code-change tasks", () => {
    expect(prompt).toMatch(/path:line/i);
    expect(prompt).toMatch(/(symbol|function name)/i);
  });

  it("requires an Acceptance field for implementation tasks", () => {
    expect(prompt).toMatch(/Acceptance/);
  });

  it("forbids vague Target values like 'relevant module'", () => {
    expect(prompt).toMatch(/(forbid|do not use|avoid).*(relevant module|vague)/i);
  });

  it("still allows looser format for doc-only / config-only tasks", () => {
    expect(prompt).toMatch(/(documentation|doc-only|config-only|non-code)/i);
  });
});

describe("getResearchPlannerSystemPrompt", () => {
  it("keeps the research planner format lenient (no Acceptance/Why required)", () => {
    const prompt = getResearchPlannerSystemPrompt();
    expect(prompt).not.toMatch(/Acceptance.*required/i);
    expect(prompt).not.toMatch(/Why.*required/i);
  });
});

describe("buildPlannerPrompt", () => {
  it("includes repo and worktree details", () => {
    const out = buildPlannerPrompt({
      workspaceName: "ws-1",
      repoPath: "github.com/org/my-repo",
      repoName: "my-repo",
      readmeContent: "# README",
      taskType: "feature",
      worktreePath: "/tmp/wt",
    });
    expect(out).toContain("my-repo");
    expect(out).toContain("ws-1");
    expect(out).toContain("/tmp/wt");
    expect(out).toContain("feature");
  });
});
