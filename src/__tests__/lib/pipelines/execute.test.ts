import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
  getOperationConfig: () => ({ batchSize: 10 }),
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => ""),
}));

vi.mock("@/lib/parsers/readme", () => ({
  parseReadmeMeta: vi.fn(() => ({ taskType: "feature" })),
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(),
  commitWorkspaceSnapshot: vi.fn(async () => {}),
  writeReportTemplates: vi.fn(async () => {}),
  writeResearchTemplates: vi.fn(async () => ""),
}));

vi.mock("@/lib/templates", () => ({
  buildExecutorPrompt: vi.fn(() => "executor-prompt"),
  buildBatchedExecutorPrompt: vi.fn(() => "batched-executor-prompt"),
  buildResearchFindingsRepoPrompt: vi.fn(() => "findings-repo-prompt"),
  buildResearchFindingsCrossRepoPrompt: vi.fn(() => "findings-cross-prompt"),
  buildResearchRecommendationsRepoPrompt: vi.fn(() => "recommendations-repo-prompt"),
  buildResearchRecommendationsCrossRepoPrompt: vi.fn(() => "recommendations-cross-prompt"),
  buildResearchIntegrationPrompt: vi.fn(() => "integration-prompt"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/executor.md"),
}));

vi.mock("@/lib/suggest-workspace", () => ({
  triggerWorkspaceSuggestion: vi.fn(),
}));

// Mock Bun.file with a per-path map so we can simulate different TODO files per repo
const mockFileMap = new Map<string, string | null>();
const originalBunFile = Bun.file;
Bun.file = vi.fn((p: string | URL) => {
  const key = typeof p === "string" ? p : p.toString();
  const content = mockFileMap.get(key);
  return {
    exists: async () => content !== undefined && content !== null,
    text: async () => content ?? "",
  };
}) as unknown as typeof Bun.file;

afterAll(() => {
  Bun.file = originalBunFile;
});

import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { listWorkspaceRepos } from "@/lib/workspace";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);

function createMockCtx(overrides?: Partial<PhaseFunctionContext>): PhaseFunctionContext {
  return {
    operationId: "test-op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => [true]),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
    ...overrides,
  };
}

describe("buildExecutePipeline — skip repo when no actionable TODO items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileMap.clear();
  });

  it("does NOT call runChild for a repo whose TODO file contains no pending or in_progress items", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "done-repo",
        repoPath: "/repos/done-repo",
        worktreePath: "/repos/done-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);

    mockFileMap.set(
      "/ws/test-ws/TODO-done-repo.md",
      "# TODO\n\n- [x] finished task\n- [x] another finished task\n",
    );

    const phases = await buildExecutePipeline({ workspace: "test-ws" });
    expect(phases).toHaveLength(1);
    const phase = phases[0];
    if (phase.kind !== "function") throw new Error("expected function phase");

    const ctx = createMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.runChild).not.toHaveBeenCalled();
  });

  it("does NOT call runChild when the TODO file is missing", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "no-todo-repo",
        repoPath: "/repos/no-todo-repo",
        worktreePath: "/repos/no-todo-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
    // No entry in mockFileMap → file doesn't exist

    const phases = await buildExecutePipeline({ workspace: "test-ws" });
    const phase = phases[0];
    if (phase.kind !== "function") throw new Error("expected function phase");

    const ctx = createMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.runChild).not.toHaveBeenCalled();
  });

  it("DOES call runChild for a repo that has a pending item", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "active-repo",
        repoPath: "/repos/active-repo",
        worktreePath: "/repos/active-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);

    mockFileMap.set(
      "/ws/test-ws/TODO-active-repo.md",
      "# TODO\n\n- [x] done\n- [ ] do this\n",
    );

    const phases = await buildExecutePipeline({ workspace: "test-ws" });
    const phase = phases[0];
    if (phase.kind !== "function") throw new Error("expected function phase");

    const ctx = createMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.runChild).toHaveBeenCalledTimes(1);
    expect(ctx.runChild).toHaveBeenCalledWith(
      "active-repo",
      expect.any(String),
      expect.objectContaining({ addDirs: ["/ws/test-ws"] }),
    );
  });

  it("skips done repos but runs active repos in the same workspace", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "done-repo",
        repoPath: "/repos/done-repo",
        worktreePath: "/repos/done-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
      {
        repoName: "active-repo",
        repoPath: "/repos/active-repo",
        worktreePath: "/repos/active-repo/worktrees/test-ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);

    mockFileMap.set(
      "/ws/test-ws/TODO-done-repo.md",
      "# TODO\n\n- [x] finished\n",
    );
    mockFileMap.set(
      "/ws/test-ws/TODO-active-repo.md",
      "# TODO\n\n- [ ] do this\n",
    );

    const phases = await buildExecutePipeline({ workspace: "test-ws" });
    const phase = phases[0];
    if (phase.kind !== "function") throw new Error("expected function phase");

    const ctx = createMockCtx();
    const result = await phase.fn(ctx);

    expect(result).toBe(true);
    expect(ctx.runChild).toHaveBeenCalledTimes(1);
    expect(ctx.runChild).toHaveBeenCalledWith(
      "active-repo",
      expect.any(String),
      expect.objectContaining({ addDirs: ["/ws/test-ws"] }),
    );
  });
});
