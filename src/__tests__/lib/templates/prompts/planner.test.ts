import { describe, expect, it } from "vitest";
import {
  getPlannerSystemPrompt,
  buildPlannerPrompt,
} from "@/lib/templates/prompts/planner";

describe("getPlannerSystemPrompt", () => {
  const prompt = getPlannerSystemPrompt();

  // That wording pushes against WRITTEN_DELIVERABLE_LENGTH and produced
  // 500-line TODO files.
  it("no longer tells the planner that format rigor outranks brevity", () => {
    expect(prompt).not.toMatch(/never trade rigor of the \*?format/i);
  });
});

describe("buildPlannerPrompt", () => {
  const baseInput = {
    workspaceName: "ws-1",
    repoPath: "github.com/org/my-repo",
    repoName: "my-repo",
    readmeContent: "# README",
    taskType: "feature" as const,
    worktreePath: "/tmp/wt",
  };

  it("includes the user instruction when provided", () => {
    const out = buildPlannerPrompt({
      ...baseInput,
      instruction: "Focus TODOs on adding tests",
    });
    expect(out).toContain("User Instruction");
    expect(out).toContain("Focus TODOs on adding tests");
  });

  it.each([undefined, "   "])(
    "omits the User Instruction section for instruction %p",
    (instruction) => {
      const out = buildPlannerPrompt({ ...baseInput, instruction });
      expect(out).not.toContain("User Instruction");
    }
  );
});

