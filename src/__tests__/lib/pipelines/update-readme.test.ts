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
const mockDiscoverConstraints = vi.fn(async () => true);
vi.mock("@/lib/pipelines/actions/ensure-repositories", () => ({
  syncReadmeRepositories: (...args: unknown[]) => mockSyncReadmeRepositories(...args),
  discoverConstraintsForNewRepos: (...args: unknown[]) => mockDiscoverConstraints(...args),
}));

// Dependencies of the criteria-feasibility phase this pipeline appends.
vi.mock("@/lib/parsers/readme", () => ({
  parseAcceptanceCriteria: vi.fn(() => []),
  renderAcceptanceCriteria: vi.fn(() => ""),
}));
vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: vi.fn(() => [
    { repoPath: "github.com/acme/repo", repoName: "repo", worktreePath: "/x" },
  ]),
}));
const mockGetReadme = vi.fn(async () => "# README");
const mockGetTodos = vi.fn(async () => [] as { filename: string }[]);
vi.mock("@/lib/workspace/reader", () => ({
  getReadme: (...a: unknown[]) => mockGetReadme(...(a as [])),
  getTodos: (...a: unknown[]) => mockGetTodos(...(a as [])),
}));

const mockScheduleAutonomousRekick = vi.fn();
const mockScheduleUpdateTodo = vi.fn();
vi.mock("@/lib/pipeline/interject", () => ({
  scheduleAutonomousRekick: (...a: unknown[]) => mockScheduleAutonomousRekick(...a),
  scheduleUpdateTodo: (...a: unknown[]) => mockScheduleUpdateTodo(...a),
}));
vi.mock("@/lib/workspace/known-findings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace/known-findings")>();
  return {
    ...actual,
    appendKnownFindings: vi.fn(async (_p: string, f: unknown[]) => f),
  };
});

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
import { parseAcceptanceCriteria } from "@/lib/parsers/readme";
import { appendKnownFindings } from "@/lib/workspace/known-findings";

const mockParseAcceptanceCriteria = vi.mocked(parseAcceptanceCriteria);
const mockAppendKnownFindings = vi.mocked(appendKnownFindings);

describe("buildUpdateReadmePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("# README");
    mockParseAcceptanceCriteria.mockReturnValue([]);
    mockSyncReadmeRepositories.mockResolvedValue({
      metaRepoCount: 0,
      existingCount: 0,
      setUp: [],
      setUpRepos: [],
      stillMissing: [],
    });
    mockDiscoverConstraints.mockResolvedValue(true);
  });

  it("returns 'Update README', 'Ensure repositories', the feasibility judge, then the follow-up judge", async () => {
    const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "add section" });
    expect(phases).toHaveLength(4);
    expect(phases[0].kind).toBe("single");
    if (phases[0].kind !== "single") throw new Error("expected single");
    expect(phases[0].label).toBe("Update README");
    expect(phases[1].kind).toBe("function");
    if (phases[1].kind !== "function") throw new Error("expected function");
    expect(phases[1].label).toBe("Ensure repositories");
    // Last, because the judge reads every worktree the README declares.
    expect(phases[2].kind).toBe("function");
    if (phases[2].kind !== "function") throw new Error("expected function");
    expect(phases[2].label).toBe("Check criteria feasibility");
    expect(phases[3].label).toBe("Decide follow-up");
  });

  it("judges feasibility on the interject path too", async () => {
    // An interject rewrites the criteria mid-run and then re-kicks autonomous,
    // which does not judge on that path — so this phase is the only check.
    const phases = await buildUpdateReadmePipeline({
      workspace: "test-ws",
      instruction: "narrow the criteria",
      interject: true,
    });
    expect(phases.map((p) => p.label)).toContain("Check criteria feasibility");
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
        setUpRepos: [{ repoName: "new", worktreePath: "/b" }],
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
        setUpRepos: [],
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
        setUpRepos: [],
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
      // Nothing to discover for; the helper's own no-op is tested with it.
      expect(mockDiscoverConstraints).toHaveBeenCalledWith(ctx, "test-ws", []);
    });

    // Constraint discovery otherwise only runs on the init path, so a
    // repository added to an existing workspace would reach review with its
    // commands NOT DECLARED.
    it("discovers constraints for the repositories it just set up", async () => {
      mockSyncReadmeRepositories.mockResolvedValue({
        metaRepoCount: 2,
        existingCount: 1,
        setUp: ["github.com/a/new"],
        setUpRepos: [{ repoName: "new", worktreePath: "/b" }],
        stillMissing: [],
      });
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockDiscoverConstraints).toHaveBeenCalledWith(
        ctx,
        "test-ws",
        [{ repoName: "new", worktreePath: "/b" }],
      );
    });

    it("reports but does not fail on incomplete constraint discovery", async () => {
      mockSyncReadmeRepositories.mockResolvedValue({
        metaRepoCount: 1,
        existingCount: 0,
        setUp: ["github.com/a/new"],
        setUpRepos: [{ repoName: "new", worktreePath: "/b" }],
        stillMissing: [],
      });
      mockDiscoverConstraints.mockResolvedValue(false);
      const phase = await getEnsurePhase();
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(ctx.emitResult).toHaveBeenCalledWith(
        expect.stringContaining("Repository Constraints"),
      );
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

  describe("criteria feasibility check", () => {
    async function getFeasibilityPhase() {
      const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "rewrite criteria" });
      const phase = phases.find((p) => p.label === "Check criteria feasibility");
      if (!phase || phase.kind !== "function") throw new Error("feasibility phase not found");
      return phase;
    }

    function ctxReturning(verdict: unknown) {
      return createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "Criteria Feasibility") {
            opts.onResultText(JSON.stringify(verdict));
          }
          return true;
        }),
      });
    }

    beforeEach(() => {
      mockParseAcceptanceCriteria.mockReturnValue([
        { text: "Rows render on the detail screen", kind: "auto", checked: false },
        { text: "Multiple IDs render most-recent-first", kind: "auto", checked: false },
        { text: "Figma comparison", kind: "manual", checked: false },
      ]);
    });

    it("records infeasible criteria in the known-findings ledger", async () => {
      const phase = await getFeasibilityPhase();
      const ctx = ctxReturning({
        infeasible: [
          {
            criterion: "Multiple IDs render most-recent-first",
            reason: "The BFF collapses UserOrders to obj[0]; the schema is owned elsewhere",
          },
        ],
        reason: "one criterion blocked upstream",
      });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).toHaveBeenCalledTimes(1);
      const [, findings] = mockAppendKnownFindings.mock.calls[0];
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe("infeasible");
      expect(findings[0].summary).toContain("Multiple IDs render most-recent-first");
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("known-findings.md"));
    });

    it("records nothing when every criterion is achievable", async () => {
      const phase = await getFeasibilityPhase();
      const ctx = ctxReturning({ infeasible: [], reason: "all achievable" });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
      expect(ctx.emitResult).toHaveBeenCalledWith(expect.stringContaining("achievable"));
    });

    it("proceeds without recording when the judge returns no verdict", async () => {
      const phase = await getFeasibilityPhase();
      // default runChild resolves true but never calls onResultText
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
    });

    it("proceeds without recording when the verdict is unparsable", async () => {
      const phase = await getFeasibilityPhase();
      const ctx = createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "Criteria Feasibility") {
            opts.onResultText("not json");
          }
          return true;
        }),
      });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockAppendKnownFindings).not.toHaveBeenCalled();
    });

    it("runs the judge read-only over the worktrees", async () => {
      const phase = await getFeasibilityPhase();
      const ctx = ctxReturning({ infeasible: [], reason: "all achievable" });

      await phase.fn(ctx);
      const opts = vi.mocked(ctx.runChild).mock.calls[0][2]!;
      // An empty list would fall back to the Edit / Write grant addDirs carries.
      expect(opts.allowedTools?.length).toBeGreaterThan(0);
      expect(opts.allowedTools!.some((t) => /^(Edit|Write)/.test(t) || t === "Bash(git:*)")).toBe(false);
      expect(opts.addDirs).toEqual(["/x"]);
    });

    it("skips the judge entirely when the README has no (auto) criteria", async () => {
      mockParseAcceptanceCriteria.mockReturnValue([
        { text: "Figma comparison", kind: "manual", checked: false },
      ]);
      const phase = await getFeasibilityPhase();
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(ctx.runChild).not.toHaveBeenCalled();
    });
  });
  describe("follow-up judge", () => {
    async function getFollowUpPhase(extra?: { interruptedAutonomous?: Record<string, string> }) {
      const phases = await buildUpdateReadmePipeline({ workspace: "test-ws", instruction: "drop the CSV export", ...extra });
      const phase = phases.find((p) => p.label === "Decide follow-up");
      if (!phase || phase.kind !== "function") throw new Error("follow-up phase not found");
      return phase;
    }

    function ctxReturning(verdict: unknown) {
      return createMockCtx({
        runChild: vi.fn(async (label, _prompt, opts) => {
          if (opts?.onResultText && label === "README Follow-up") {
            opts.onResultText(typeof verdict === "string" ? verdict : JSON.stringify(verdict));
          }
          return true;
        }),
      });
    }

    beforeEach(() => {
      mockScheduleAutonomousRekick.mockReset();
      mockScheduleUpdateTodo.mockReset();
    });

    it("shows the judge the README before and after the update and the TODO files", async () => {
      // Read at build time, before the updater runs.
      mockFileText.mockResolvedValue("# README\nold goal");
      const phase = await getFollowUpPhase();
      mockGetReadme.mockResolvedValueOnce("# README\nnew goal");
      mockGetTodos.mockResolvedValueOnce([{ filename: "TODO-repo.md" }]);
      mockFileText.mockResolvedValue("- [ ] build CSV export");
      const ctx = ctxReturning({ updateTodo: true, autonomous: true, reason: "r" });

      await phase.fn(ctx);
      const prompt = vi.mocked(ctx.runChild).mock.calls[0][1];
      expect(prompt).toContain("old goal");
      expect(prompt).toContain("new goal");
      expect(prompt).toContain("- [ ] build CSV export");
    });

    it("restarts autonomous from update-todo with a re-plan instruction when the plan moved", async () => {
      const phase = await getFollowUpPhase();
      const ctx = ctxReturning({ updateTodo: true, autonomous: true, reason: "export removed" });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith(
        "test-op",
        "test-ws",
        { instruction: expect.stringContaining("export removed") },
        "update-todo",
      );
      expect(mockScheduleUpdateTodo).not.toHaveBeenCalled();
    });

    it("starts autonomous from execute when only implementation is left", async () => {
      const phase = await getFollowUpPhase();
      const ctx = ctxReturning({ updateTodo: false, autonomous: true, reason: "" });

      await phase.fn(ctx);
      expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith("test-op", "test-ws", {}, "execute");
    });

    it("re-plans TODOs alone when no implementation should run", async () => {
      const phase = await getFollowUpPhase();
      const ctx = ctxReturning({ updateTodo: true, autonomous: false, reason: "" });

      await phase.fn(ctx);
      expect(mockScheduleUpdateTodo).toHaveBeenCalledWith("test-op", "test-ws", expect.stringContaining("drop the CSV export"));
      expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
    });

    it("starts nothing when the change needs no follow-up", async () => {
      const phase = await getFollowUpPhase();
      const ctx = ctxReturning({ updateTodo: false, autonomous: false, reason: "typo" });

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
      expect(mockScheduleUpdateTodo).not.toHaveBeenCalled();
    });

    it("always restarts an interrupted autonomous run, keeping its inputs", async () => {
      const phase = await getFollowUpPhase({ interruptedAutonomous: { description: "task", maxLoops: "3" } });
      const ctx = ctxReturning({ updateTodo: false, autonomous: false, reason: "typo" });

      await phase.fn(ctx);
      expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith(
        "test-op",
        "test-ws",
        { description: "task", maxLoops: "3" },
        "execute",
      );
    });

    it("restarts an interrupted run from update-todo when the judge gives no verdict", async () => {
      const phase = await getFollowUpPhase({ interruptedAutonomous: { description: "task" } });
      const ctx = ctxReturning("not json");

      await phase.fn(ctx);
      expect(mockScheduleAutonomousRekick).toHaveBeenCalledWith(
        "test-op",
        "test-ws",
        expect.objectContaining({ description: "task" }),
        "update-todo",
      );
    });

    it("starts nothing on an idle workspace when the judge gives no verdict", async () => {
      const phase = await getFollowUpPhase();
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockScheduleAutonomousRekick).not.toHaveBeenCalled();
      expect(mockScheduleUpdateTodo).not.toHaveBeenCalled();
    });
  });
});
