import { vi, describe, it, expect } from "vitest";
import { buildInitPipeline } from "@/lib/pipelines/init";

vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  parseAnalysisResultText: vi.fn(),
  setupWorkspace: vi.fn(),
  commitWorkspaceSnapshot: vi.fn(),
  writeTodoTemplate: vi.fn(),
  writeReportTemplates: vi.fn(),
}));
vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: vi.fn(),
}));
vi.mock("@/lib/templates", () => ({
  buildReadmeContent: vi.fn((desc: string, type: string, ticket: string, date: string) => `# Task: TBD\n\n## Initial Request\n\n${desc}\n\n${type} ${ticket} ${date}`),
  buildInitAnalyzeAndReadmePrompt: vi.fn(() => "prompt"),
  INIT_ANALYSIS_SCHEMA: {},
  buildPlannerPrompt: vi.fn(() => "planner-prompt"),
  buildCoordinatorPrompt: vi.fn(() => "coordinator-prompt"),
  buildReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  buildBestOfNFileReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  BEST_OF_N_REVIEW_SCHEMA: {},
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

const EXPECTED_LABELS = [
  "Analyze & draft README",
  "Setup workspace",
  "Discover repo constraints",
  "Plan TODO items",
  "Coordinate TODOs",
  "Review TODOs",
  "Commit snapshot",
];

const labelsOf = (phases: ReturnType<typeof buildInitPipeline>) =>
  phases.map((p) => (p.kind === "function" || p.kind === "single" ? p.label : "group"));

describe("buildInitPipeline", () => {
  it("phases have expected labels", () => {
    expect(labelsOf(buildInitPipeline("test description"))).toEqual(EXPECTED_LABELS);
  });

  it("all phases are function kind", () => {
    for (const phase of buildInitPipeline("test description")) {
      expect(phase.kind).toBe("function");
    }
  });

  // Best-of-N fans out inside the existing phases rather than adding any.
  it.each([{ bestOfN: 3 }, { bestOfN: 2, bestOfNConfirm: true }])(
    "keeps the same phases with %o",
    (options) => {
      expect(labelsOf(buildInitPipeline("desc", undefined, options))).toEqual(EXPECTED_LABELS);
    },
  );
});
