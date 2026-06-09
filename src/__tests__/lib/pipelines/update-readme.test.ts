import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/templates", () => ({
  buildReadmeUpdaterPrompt: vi.fn(() => "readme-updater-prompt"),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/readme-updater.md"),
}));

const mockSyncReadmeRepositories = vi.fn();
vi.mock("@/lib/pipelines/actions/ensure-repositories", () => ({
  syncReadmeRepositories: (...args: unknown[]) => mockSyncReadmeRepositories(...args),
}));

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

const mockFileExists = vi.fn();
const mockFileText = vi.fn();
const originalBunFile = Bun.file;
Bun.file = vi.fn(() => ({
  exists: mockFileExists,
  text: mockFileText,
})) as unknown as typeof Bun.file;

afterAll(() => {
  Bun.file = originalBunFile;
});

import { buildUpdateReadmePipeline } from "@/lib/pipelines/update-readme";

describe("buildUpdateReadmePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("# README");
    mockSyncReadmeRepositories.mockResolvedValue({
      metaRepoCount: 0,
      existingCount: 0,
      setUp: [],
      stillMissing: [],
    });
  });

  it("returns an 'Update README' phase followed by 'Ensure repositories'", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    expect(phases).toHaveLength(2);
    expect(phases[0].kind).toBe("single");
    if (phases[0].kind !== "single") throw new Error("expected single");
    expect(phases[0].label).toBe("Update README");
    expect(phases[1].kind).toBe("function");
    if (phases[1].kind !== "function") throw new Error("expected function");
    expect(phases[1].label).toBe("Ensure repositories");
  });

  describe("Ensure repositories phase", () => {
    async function getEnsurePhase() {
      const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add repo" });
      const phase = phases[1];
      if (phase.kind !== "function") throw new Error("expected function");
      return phase;
    }

    it("sets up repositories newly added to the README and reports them", async () => {
      mockSyncReadmeRepositories.mockResolvedValue({
        metaRepoCount: 2,
        existingCount: 1,
        setUp: ["github.com/a/new"],
        stillMissing: [],
      });
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      const result = await phase.fn(ctx);

      expect(result).toBe(true);
      expect(mockSyncReadmeRepositories).toHaveBeenCalledWith(
        "test-ws",
        ctx.emitStatus,
        ctx.signal,
      );
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("github.com/a/new"));
    });

    it("does not fail the operation when a repository could not be set up", async () => {
      mockSyncReadmeRepositories.mockResolvedValue({
        metaRepoCount: 1,
        existingCount: 0,
        setUp: [],
        stillMissing: ["github.com/x/y"],
      });
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      const result = await phase.fn(ctx);

      expect(result).toBe(true);
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("github.com/x/y"));
    });

    it("does not fail the operation when the README cannot be read", async () => {
      mockSyncReadmeRepositories.mockResolvedValue({
        metaRepoCount: 0,
        existingCount: 0,
        setUp: [],
        stillMissing: [],
        readError: "boom",
      });
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      const result = await phase.fn(ctx);

      expect(result).toBe(true);
    });

    it("is a no-op when there are no new repositories", async () => {
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      const result = await phase.fn(ctx);

      expect(result).toBe(true);
      expect(ctx.emitResult).not.toHaveBeenCalled();
    });
  });

  it("restricts allowedTools to README.md edit/write + git", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    const phase = phases[0];
    if (phase.kind !== "single") throw new Error("expected single");
    expect(phase.allowedTools).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Edit\(.*README\.md\)/),
        expect.stringMatching(/Write\(.*README\.md\)/),
        "Bash(git:*)",
      ]),
    );
  });

  it("threads interject=true into buildReadmeUpdaterPrompt", async () => {
    const { buildReadmeUpdaterPrompt } = await import("@/lib/templates");
    const mockBuild = vi.mocked(buildReadmeUpdaterPrompt);
    mockBuild.mockClear();

    await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section", interject: true });

    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ interject: true }),
    );
  });

  it("addDirs points at the workspace path", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    const phase = phases[0];
    if (phase.kind !== "single") throw new Error("expected single");
    expect(phase.addDirs).toEqual([expect.stringContaining("test-ws")]);
  });
});
