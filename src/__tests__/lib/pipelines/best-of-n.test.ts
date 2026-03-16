import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/config", () => ({
  WORKSPACE_DIR: "/tmp/test-workspace",
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => "# Test README"),
}));

const mockCreateSubWorktrees = vi.fn();
const mockGetSubWorktreeDiff = vi.fn();
const mockGetBaseCommit = vi.fn();
const mockApplySubWorktreeResult = vi.fn();
const mockCleanupSubWorktrees = vi.fn();

vi.mock("@/lib/pipelines/actions/best-of-n-worktree", () => ({
  createSubWorktrees: (...args: unknown[]) => mockCreateSubWorktrees(...args),
  getSubWorktreeDiff: (...args: unknown[]) => mockGetSubWorktreeDiff(...args),
  getBaseCommit: (...args: unknown[]) => mockGetBaseCommit(...args),
  applySubWorktreeResult: (...args: unknown[]) => mockApplySubWorktreeResult(...args),
  cleanupSubWorktrees: (...args: unknown[]) => mockCleanupSubWorktrees(...args),
}));

vi.mock("@/lib/templates", () => ({
  buildBestOfNReviewerPrompt: vi.fn(() => "reviewer prompt"),
  BEST_OF_N_REVIEW_SCHEMA: { type: "object" },
}));

import { buildBestOfNPipeline } from "@/lib/pipelines/best-of-n";
import type { PhaseFunctionContext } from "@/types/pipeline";
import type { WorkspaceRepo } from "@/types/workspace";
import type { SubWorktree } from "@/lib/pipelines/actions/best-of-n-worktree";

function makeSubWorktrees(repos: WorkspaceRepo[], n: number): SubWorktree[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    label: `candidate-${i + 1}`,
    repoPaths: new Map(repos.map((r) => [r.repoPath, `/tmp/test-workspace/ws/tmp/bon-${i + 1}/${r.repoPath}`])),
    branchNames: new Map(repos.map((r) => [r.repoPath, `main-bon-${i + 1}`])),
    repos: repos.map((r) => ({
      ...r,
      worktreePath: `/tmp/test-workspace/ws/tmp/bon-${i + 1}/${r.repoPath}`,
    })),
  }));
}

function makeMockCtx(overrides?: Partial<PhaseFunctionContext>): PhaseFunctionContext {
  return {
    operationId: "test-op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async () => ({ "question": "Let reviewer decide" })),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => [true]),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("buildBestOfNPipeline", () => {
  const repos: WorkspaceRepo[] = [
    {
      repoPath: "github.com/org/repo",
      repoName: "repo",
      worktreePath: "/tmp/test-workspace/ws/github.com/org/repo",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates 6 pipeline phases", async () => {
    const phases = await buildBestOfNPipeline({
      workspace: "ws",
      n: 2,
      operationType: "execute",
      buildCandidatePhases: async () => [],
      repos,
    });

    expect(phases).toHaveLength(6);
    expect(phases[0].kind).toBe("function");
    expect((phases[0] as { label: string }).label).toBe("Best-of-N: Setup");
    expect((phases[1] as { label: string }).label).toBe("Best-of-N: Run candidates");
    expect((phases[2] as { label: string }).label).toBe("Best-of-N: Choose");
    expect((phases[3] as { label: string }).label).toBe("Best-of-N: Review");
    expect((phases[4] as { label: string }).label).toBe("Best-of-N: Apply");
    expect((phases[5] as { label: string }).label).toBe("Best-of-N: Cleanup");
  });

  describe("Phase 1: Setup", () => {
    it("creates sub-worktrees", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
      });

      const ctx = makeMockCtx();
      const setupFn = (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await setupFn(ctx);

      expect(result).toBe(true);
      expect(mockCreateSubWorktrees).toHaveBeenCalledWith("ws", repos, 2, expect.any(Function));
    });

    it("returns false on setup failure", async () => {
      mockCreateSubWorktrees.mockImplementation(() => {
        throw new Error("git error");
      });

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
      });

      const ctx = makeMockCtx();
      const setupFn = (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await setupFn(ctx);

      expect(result).toBe(false);
    });
  });

  describe("Phase 2: Run candidates", () => {
    it("runs all candidates and succeeds if at least one succeeds", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      let callCount = 0;
      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => {
          callCount++;
          // Return a simple function phase
          return [{
            kind: "function" as const,
            label: `test-phase-${callCount}`,
            fn: async () => true,
          }];
        },
        repos,
      });

      // First run setup to populate subWorktrees
      const setupCtx = makeMockCtx();
      await (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn(setupCtx);

      // Then run candidates
      const ctx = makeMockCtx();
      const runFn = (phases[1] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await runFn(ctx);

      expect(result).toBe(true);
    });

    it("returns false if all candidates fail", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [{
          kind: "function" as const,
          label: "failing-phase",
          fn: async () => false,
        }],
        repos,
      });

      // Setup
      await (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn(makeMockCtx());

      // Run candidates
      const ctx = makeMockCtx();
      const runFn = (phases[1] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await runFn(ctx);

      expect(result).toBe(false);
    });
  });

  describe("Phase 3: Choose", () => {
    it("auto-selects when only one candidate succeeds", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      let callIdx = 0;
      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [{
          kind: "function" as const,
          label: "phase",
          fn: async () => {
            callIdx++;
            return callIdx === 1; // Only first candidate succeeds
          },
        }],
        repos,
      });

      // Setup
      await (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn(makeMockCtx());
      // Run candidates
      await (phases[1] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn(makeMockCtx());

      // Choose — should auto-select
      const ctx = makeMockCtx();
      const chooseFn = (phases[2] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await chooseFn(ctx);

      expect(result).toBe(true);
      expect(ctx.emitAsk).not.toHaveBeenCalled(); // No human interaction needed
    });
  });

  describe("confirm option", () => {
    it("asks user and proceeds with Best-of-N when confirmed", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
        confirm: true,
        buildNormalPhases: async () => [{
          kind: "function" as const,
          label: "normal-phase",
          fn: async () => true,
        }],
      });

      const ctx = makeMockCtx({
        emitAsk: vi.fn(async () => ({ "question": "Use Best-of-N" })),
      });
      const setupFn = (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await setupFn(ctx);

      expect(result).toBe(true);
      expect(ctx.emitAsk).toHaveBeenCalledTimes(1);
      // Should have created sub-worktrees
      expect(mockCreateSubWorktrees).toHaveBeenCalled();
    });

    it("runs normal phases when user declines Best-of-N", async () => {
      const normalPhaseFn = vi.fn(async () => true);

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
        confirm: true,
        buildNormalPhases: async () => [{
          kind: "function" as const,
          label: "normal-execute",
          fn: normalPhaseFn,
        }],
      });

      const ctx = makeMockCtx({
        emitAsk: vi.fn(async () => ({ "question": "Normal execution" })),
      });

      // Setup — should run normal phases instead
      const setupFn = (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const setupResult = await setupFn(ctx);

      expect(setupResult).toBe(true);
      expect(mockCreateSubWorktrees).not.toHaveBeenCalled();
      expect(normalPhaseFn).toHaveBeenCalled();

      // Remaining phases should be skipped (return true immediately)
      for (let i = 1; i < 6; i++) {
        const fn = (phases[i] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
        const result = await fn(makeMockCtx());
        expect(result).toBe(true);
      }
    });

    it("does not ask when confirm is false", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
        confirm: false,
      });

      const ctx = makeMockCtx();
      const setupFn = (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      await setupFn(ctx);

      expect(ctx.emitAsk).not.toHaveBeenCalled();
      expect(mockCreateSubWorktrees).toHaveBeenCalled();
    });
  });

  describe("Phase 6: Cleanup", () => {
    it("always succeeds even if cleanup fails", async () => {
      const subWTs = makeSubWorktrees(repos, 2);
      mockCreateSubWorktrees.mockReturnValue(subWTs);
      mockCleanupSubWorktrees.mockImplementation(() => {
        throw new Error("cleanup error");
      });

      const phases = await buildBestOfNPipeline({
        workspace: "ws",
        n: 2,
        operationType: "execute",
        buildCandidatePhases: async () => [],
        repos,
      });

      // Setup
      await (phases[0] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn(makeMockCtx());

      // Cleanup
      const ctx = makeMockCtx();
      const cleanupFn = (phases[5] as { fn: (ctx: PhaseFunctionContext) => Promise<boolean> }).fn;
      const result = await cleanupFn(ctx);

      expect(result).toBe(true); // Cleanup failure is not fatal
    });
  });
});
