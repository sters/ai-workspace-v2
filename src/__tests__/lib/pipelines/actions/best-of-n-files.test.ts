import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

const mockMkdirSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => "");
const mockRmSync = vi.fn();

vi.mock("@/lib/templates", () => ({
  buildBestOfNFileReviewerPrompt: vi.fn(() => "reviewer-prompt"),
  buildBestOfNFileSynthesizerPrompt: vi.fn(() => "synthesizer-prompt"),
  BEST_OF_N_REVIEW_SCHEMA: {},
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/file.md"),
  ensureGlobalSystemPrompt: vi.fn(() => "/mock/prompts/global.md"),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  },
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
}));
import { runBestOfNFiles } from "@/lib/pipelines/actions/best-of-n-files";

function makeMockCtx(overrides?: Partial<PhaseFunctionContext>): PhaseFunctionContext {
  return {
    operationId: "test-op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(async () => ({})),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async (children) => children.map(() => true)),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("runBestOfNFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs candidates in parallel via runChildGroup", async () => {
    const ctx = makeMockCtx({
      emitAsk: vi.fn(async () => ({ question: "Pick candidate-1" })),
    });

    const buildChildren = vi.fn((_dir: string, _label: string) => [
      { label: "test-child", prompt: "test-prompt" },
    ]);

    await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren,
    });

    // buildChildren called once per candidate
    expect(buildChildren).toHaveBeenCalledTimes(2);
    // All children flattened into single runChildGroup call
    expect(ctx.runChildGroup).toHaveBeenCalledTimes(1);
    const children = (ctx.runChildGroup as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(children).toHaveLength(2);
    expect(children[0].label).toContain("candidate-1");
    expect(children[1].label).toContain("candidate-2");
  });

  it("returns false when all candidates fail", async () => {
    const ctx = makeMockCtx({
      runChildGroup: vi.fn(async (children) => children.map(() => false)),
    });

    const result = await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [{ label: "child", prompt: "prompt" }],
    });

    expect(result).toBe(false);
  });

  it("auto-selects when only one candidate succeeds", async () => {
    const ctx = makeMockCtx({
      runChildGroup: vi.fn(async (children) =>
        children.map((_: unknown, i: number) => i === 0), // Only first succeeds
      ),
    });

    const result = await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [{ label: "child", prompt: "prompt" }],
    });

    expect(result).toBe(true);
    expect(ctx.emitAsk).not.toHaveBeenCalled();
  });

  it("runs AI reviewer when multiple candidates succeed", async () => {
    const ctx = makeMockCtx();

    const result = await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [{ label: "child", prompt: "prompt" }],
    });

    expect(result).toBe(true);
    // Reviewer is called via runChild (not emitAsk)
    expect(ctx.runChild).toHaveBeenCalled();
    const reviewerCall = (ctx.runChild as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === "Best-of-N File Reviewer",
    );
    expect(reviewerCall).toBeDefined();
  });

  it("passes candidate dir to buildChildren", async () => {
    const ctx = makeMockCtx({
      emitAsk: vi.fn(async () => ({ question: "Pick candidate-1" })),
    });

    const dirs: string[] = [];
    await runBestOfNFiles({
      ctx,
      n: 3,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: (dir) => {
        dirs.push(dir);
        return [{ label: "child", prompt: "prompt" }];
      },
    });

    expect(dirs).toHaveLength(3);
    // Each candidate gets a unique temp dir
    expect(new Set(dirs).size).toBe(3);
  });

  describe("confirm option", () => {
    it("asks for confirmation when confirm is true", async () => {
      const ctx = makeMockCtx({
        emitAsk: vi.fn(async () => ({ question: "Use Best-of-N" })),
      });

      await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
        confirm: true,
      });

      expect(ctx.emitAsk).toHaveBeenCalled();
      const firstCall = (ctx.emitAsk as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(firstCall[0].question).toContain("Best-of-N mode is enabled");
    });

    it("runs normal execution when user declines", async () => {
      const normalFn = vi.fn(async () => true);
      const ctx = makeMockCtx({
        emitAsk: vi.fn(async () => ({ question: "Normal execution" })),
      });

      const result = await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
        confirm: true,
        runNormal: normalFn,
      });

      expect(result).toBe(true);
      expect(normalFn).toHaveBeenCalled();
      expect(ctx.runChildGroup).not.toHaveBeenCalled();
    });

    it("does not ask confirmation when confirm is false", async () => {
      const ctx = makeMockCtx();

      await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
        confirm: false,
      });

      // emitAsk should not be called for confirmation
      expect(ctx.emitAsk).not.toHaveBeenCalled();
    });
  });

  describe("interactionLevel", () => {
    it("asks user to confirm reviewer decision when interactionLevel is high", async () => {
      const ctx = makeMockCtx({
        emitAsk: vi.fn(async () => ({ question: "Accept" })),
      });

      await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
        interactionLevel: "high",
      });

      // emitAsk is called for post-review confirmation
      expect(ctx.emitAsk).toHaveBeenCalled();
      const askCall = (ctx.emitAsk as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0][0].question.includes("Accept"),
      );
      expect(askCall).toBeDefined();
    });

    it("does not ask user when interactionLevel is low", async () => {
      const ctx = makeMockCtx();

      await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
        interactionLevel: "low",
      });

      expect(ctx.emitAsk).not.toHaveBeenCalled();
    });

    it("does not ask user when interactionLevel is not set", async () => {
      const ctx = makeMockCtx();

      await runBestOfNFiles({
        ctx,
        n: 2,
        operationType: "test-op",
        filesToCapture: ["/tmp/ws/file1.md"],
        buildChildren: () => [{ label: "child", prompt: "prompt" }],
      });

      expect(ctx.emitAsk).not.toHaveBeenCalled();
    });
  });

  it("cleans up temp dirs after execution", async () => {
    const ctx = makeMockCtx({
      emitAsk: vi.fn(async () => ({ question: "Pick candidate-1" })),
    });

    await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [{ label: "child", prompt: "prompt" }],
    });

    expect(mockRmSync).toHaveBeenCalled();
  });

  it("cleans up even when execution fails", async () => {
    const ctx = makeMockCtx({
      runChildGroup: vi.fn(async (children) => children.map(() => false)),
    });

    await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [{ label: "child", prompt: "prompt" }],
    });

    expect(mockRmSync).toHaveBeenCalled();
  });

  it("handles multi-child candidates correctly", async () => {
    // Simulate: candidate-1 has 2 children (both succeed), candidate-2 has 2 children (one fails)
    const ctx = makeMockCtx({
      runChildGroup: vi.fn(async () => [true, true, true, false]),
      emitAsk: vi.fn(async () => ({})),
    });

    const result = await runBestOfNFiles({
      ctx,
      n: 2,
      operationType: "test-op",
      filesToCapture: ["/tmp/ws/file1.md"],
      buildChildren: () => [
        { label: "child-a", prompt: "prompt-a" },
        { label: "child-b", prompt: "prompt-b" },
      ],
    });

    // candidate-1 succeeded (both true), candidate-2 failed (one false) → auto-select
    expect(result).toBe(true);
    expect(ctx.emitAsk).not.toHaveBeenCalled();
  });
});
