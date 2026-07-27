import { describe, expect, it } from "vitest";
import {
  buildAutonomousGatePrompt,
  getAutonomousGateSystemPrompt,
  AUTONOMOUS_GATE_SCHEMA,
} from "@/lib/templates/prompts/autonomous-gate";

describe("AUTONOMOUS_GATE_SCHEMA", () => {
  it("has required fields", () => {
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("shouldLoop");
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("giveUp");
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("reason");
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("fixableIssues");
  });
});

describe("buildAutonomousGatePrompt", () => {
  const baseInput = {
    workspaceName: "test-ws",
    reviewSummary: "# Review Summary\n2 critical issues found.",
    reviewFiles: [
      { name: "review-repo-a.md", content: "Critical: missing error handling" },
    ],
    todoFiles: [
      { repoName: "repo-a", content: "- [ ] Add error handling\n- [x] Setup project" },
    ],
    readmeContent: "# Test Workspace\nFix bugs in repo-a.",
    loopIteration: 1,
    maxLoops: 3,
  };

  it("includes workspace name", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("test-ws");
  });

  it("includes loop iteration info", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("1 / 3");
  });

  it("includes review summary", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("2 critical issues found");
  });

  it("includes review files", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("review-repo-a.md");
    expect(prompt).toContain("missing error handling");
  });

  it("includes TODO files", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("TODO-repo-a.md");
    expect(prompt).toContain("Add error handling");
  });

  it("includes README content", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).toContain("Fix bugs in repo-a");
  });

  it("adds final iteration note when at max loops", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      loopIteration: 3,
      maxLoops: 3,
    });
    expect(prompt).toContain("final iteration");
    expect(prompt).toContain("MUST set `shouldLoop: false`");
  });

  it("does not add final iteration note when below max loops", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).not.toContain("final iteration");
  });

  it("handles empty review files", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      reviewFiles: [],
    });
    expect(prompt).toContain("(no review files)");
  });

  it("handles empty TODO files", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      todoFiles: [],
    });
    expect(prompt).toContain("(no TODO files)");
  });

  it("instructs to evaluate all severity levels including warnings and suggestions", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("warnings");
    expect(systemPrompt).toContain("suggestions");
    expect(systemPrompt).toContain("every severity level");
  });

  it("defaults to fixing actionable issues", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("Default to fixing");
    expect(systemPrompt).toContain("Err on the side of addressing issues");
  });

  it("lists concrete examples of fixable issues including struct layouts", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("Typos");
    expect(systemPrompt).toContain("stale references");
    expect(systemPrompt).toContain("struct/type layouts");
    expect(systemPrompt).toContain("suboptimal data structures");
  });

  it("marks the loop-trigger examples as non-exhaustive", () => {
    // Claude follows enumerations literally, so an unlabelled list reads as closed.
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toMatch(/not an exhaustive list|illustrative/i);
  });

  it("keeps the Decision Criteria list contiguously numbered", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    const section = systemPrompt.slice(
      systemPrompt.indexOf("### Decision Criteria"),
      systemPrompt.indexOf("### Confidence Filtering"),
    );
    const numbers = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("treats low-confidence findings as insufficient grounds for a loop", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("### Confidence Filtering");
    expect(systemPrompt).toMatch(/low confidence.*does NOT by itself justify a loop/is);
    expect(systemPrompt).toMatch(/no annotation.*treat as medium/is);
    expect(systemPrompt).toMatch(/coverage over filtering/i);
  });

  it("includes give-up instructions for stagnation detection", () => {
    const systemPrompt = getAutonomousGateSystemPrompt();
    expect(systemPrompt).toContain("giveUp");
    expect(systemPrompt).toContain("stagnation");
  });

  it("includes previous gate results when provided", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      loopIteration: 2,
      previousGateResults: [
        { cycle: 1, reason: "Fix typo found", fixableIssues: ["Fix typo in main.go"] },
      ],
    });
    expect(prompt).toContain("Previous Gate Decisions");
    expect(prompt).toContain("Cycle 1");
    expect(prompt).toContain("Fix typo found");
    expect(prompt).toContain("Fix typo in main.go");
  });

  it("does not include previous gate results section when empty", () => {
    const prompt = buildAutonomousGatePrompt({
      ...baseInput,
      previousGateResults: [],
    });
    expect(prompt).not.toContain("Previous Gate Decisions");
  });

  it("does not include previous gate results section when undefined", () => {
    const prompt = buildAutonomousGatePrompt(baseInput);
    expect(prompt).not.toContain("Previous Gate Decisions");
  });
});
