import { describe, expect, it } from "vitest";
import {
  buildAutonomousGatePrompt,
  getAutonomousGateSystemPrompt,
  AUTONOMOUS_GATE_SCHEMA,
} from "@/lib/templates/prompts/autonomous-gate";

describe("AUTONOMOUS_GATE_SCHEMA", () => {
  it("has required fields", () => {
    expect(AUTONOMOUS_GATE_SCHEMA.required).toContain("shouldLoop");
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
});
