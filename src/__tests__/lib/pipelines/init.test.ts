import { vi, describe, it, expect } from "vitest";
import { buildInitPipeline } from "@/lib/pipelines/init";

vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  parseAnalysisResultText: vi.fn(),
  setupWorkspace: vi.fn(),
  setupRepository: vi.fn(),
  commitWorkspaceSnapshot: vi.fn(),
  writeTodoTemplate: vi.fn(),
  writeReportTemplates: vi.fn(),
  README_TEMPLATE: "# Task: TBD\n\n## Initial Request\n\n{{DESCRIPTION}}\n\n{{TASK_TYPE}} {{TICKET_ID}} {{DATE}}",
}));
vi.mock("@/lib/prompts", () => ({
  buildInitAnalyzeAndReadmePrompt: vi.fn(() => "prompt"),
  INIT_ANALYSIS_SCHEMA: {},
  buildPlannerPrompt: vi.fn(() => "planner-prompt"),
  buildCoordinatorPrompt: vi.fn(() => "coordinator-prompt"),
  buildReviewerPrompt: vi.fn(() => "reviewer-prompt"),
}));

describe("buildInitPipeline", () => {
  it("returns 7 phases", () => {
    const phases = buildInitPipeline("test description");
    expect(phases).toHaveLength(7);
  });

  it("all phases are function kind", () => {
    const phases = buildInitPipeline("test description");
    for (const phase of phases) {
      expect(phase.kind).toBe("function");
    }
  });

  it("phases have expected labels", () => {
    const phases = buildInitPipeline("test description");
    const labels = phases.map((p) => {
      if (p.kind === "function" || p.kind === "single") return p.label;
      return "group";
    });
    expect(labels).toEqual([
      "Analyze & draft README",
      "Setup workspace",
      "Prepare for planning",
      "Plan TODO items",
      "Coordinate TODOs",
      "Review TODOs",
      "Commit snapshot",
    ]);
  });

  it("returns a new array each call (independent closure state)", () => {
    const phases1 = buildInitPipeline("desc 1");
    const phases2 = buildInitPipeline("desc 2");
    expect(phases1).not.toBe(phases2);
  });
});
