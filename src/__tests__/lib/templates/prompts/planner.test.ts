import { describe, expect, it } from "vitest";
import {
  getPlannerSystemPrompt,
  getResearchPlannerSystemPrompt,
  buildPlannerPrompt,
} from "@/lib/templates/prompts/planner";
import {
  REPO_SEARCH_EFFICIENCY,
  WRITTEN_DELIVERABLE_LENGTH,
} from "@/lib/templates/prompts/shared";

describe("getPlannerSystemPrompt", () => {
  const prompt = getPlannerSystemPrompt();

  it("requires the three fields the executor cannot proceed without", () => {
    expect(prompt).toMatch(/Target:.*\(required/i);
    expect(prompt).toMatch(/Action:.*\(required/i);
    expect(prompt).toMatch(/Verify:.*\(required/i);
  });

  it("makes Pattern and Why conditional so items are not padded to a fixed shape", () => {
    // These were once mandatory on every code-change item, which cost the planner
    // a search per item to find an analogue and the executor a re-read per batch.
    expect(prompt).toMatch(/Pattern:.*\((only|omit|when)/i);
    expect(prompt).toMatch(/Why:.*\((only|omit|when)/i);
    expect(prompt).not.toMatch(/Pattern:.*\(required/i);
    expect(prompt).not.toMatch(/Why:.*\(required/i);
  });

  it("does not mandate a separate Acceptance field on top of Verify", () => {
    expect(prompt).not.toMatch(/Acceptance:.*\(required/i);
  });

  it("requires Verify to be a check that can pass or fail", () => {
    expect(prompt).toMatch(/pass or fail|checkable/i);
    expect(prompt).toMatch(/NOT "ensure it works"/);
  });

  it("tells the planner to write only what changes the executor's behavior", () => {
    expect(prompt).toContain(WRITTEN_DELIVERABLE_LENGTH);
    // The old wording pushed the opposite way ("never trade rigor of the format
    // for brevity"), which is what produced 500-line TODO files.
    expect(prompt).not.toMatch(/never trade rigor of the \*?format/i);
  });

  it("carries the repo search efficiency policy", () => {
    expect(prompt).toContain(REPO_SEARCH_EFFICIENCY);
  });

  it("requires path:line or path + symbol/function for Target on code-change tasks", () => {
    expect(prompt).toMatch(/path:line/i);
    expect(prompt).toMatch(/(symbol|function name)/i);
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

  it("omits the User Instruction section when no instruction is given", () => {
    const out = buildPlannerPrompt({
      workspaceName: "ws-1",
      repoPath: "github.com/org/my-repo",
      repoName: "my-repo",
      readmeContent: "# README",
      taskType: "feature",
      worktreePath: "/tmp/wt",
    });
    expect(out).not.toContain("User Instruction");
  });

  it("includes the user instruction when provided", () => {
    const out = buildPlannerPrompt({
      workspaceName: "ws-1",
      repoPath: "github.com/org/my-repo",
      repoName: "my-repo",
      readmeContent: "# README",
      taskType: "feature",
      worktreePath: "/tmp/wt",
      instruction: "Focus TODOs on adding tests",
    });
    expect(out).toContain("User Instruction");
    expect(out).toContain("Focus TODOs on adding tests");
  });

  it("ignores a whitespace-only instruction", () => {
    const out = buildPlannerPrompt({
      workspaceName: "ws-1",
      repoPath: "github.com/org/my-repo",
      repoName: "my-repo",
      readmeContent: "# README",
      taskType: "feature",
      worktreePath: "/tmp/wt",
      instruction: "   ",
    });
    expect(out).not.toContain("User Instruction");
  });
});
