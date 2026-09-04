import { vi, describe, it, expect, beforeEach } from "vitest";
import type { PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/templates", () => ({
  buildRepoConstraintsPrompt: vi.fn((input: { repoName: string }) => `prompt-${input.repoName}`),
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/repo-constraints.md"),
}));
vi.mock("@/lib/parsers/readme", () => ({
  readWorkspaceReadme: vi.fn(),
  parseConstraints: vi.fn(),
}));

import { buildDiscoverConstraintsPhase } from "@/lib/pipelines/actions/discover-constraints";
import { readWorkspaceReadme, parseConstraints } from "@/lib/parsers/readme";

const mockReadReadme = vi.mocked(readWorkspaceReadme);
const mockParseConstraints = vi.mocked(parseConstraints);

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

function phaseFor(repos: { repoName: string; worktreePath: string }[]) {
  return buildDiscoverConstraintsPhase({ workspace: "ws", wsPath: "/ws/ws", repos });
}

describe("buildDiscoverConstraintsPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadReadme.mockResolvedValue({
      content: "# README",
      meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
    });
    mockParseConstraints.mockReturnValue([]);
  });

  it("spawns one child per repository when nothing is declared yet", async () => {
    const phase = phaseFor([
      { repoName: "a", worktreePath: "/w/a" },
      { repoName: "b", worktreePath: "/w/b" },
    ]);
    const ctx = createMockCtx({ runChildGroup: vi.fn(async () => [true, true]) });

    expect(await phase.fn(ctx)).toBe(true);
    expect(ctx.runChildGroup).toHaveBeenCalledTimes(1);
    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children.map((c) => c.label)).toEqual(["constraints-a", "constraints-b"]);
  });

  it("skips a repository whose constraints the README already declares", async () => {
    // Re-running would append a second `### a` block, which the constraint
    // runner then executes twice.
    mockParseConstraints.mockReturnValue([
      { repoName: "a", constraints: [{ label: "Lint", command: "make lint" }] },
    ]);
    const phase = phaseFor([
      { repoName: "a", worktreePath: "/w/a" },
      { repoName: "b", worktreePath: "/w/b" },
    ]);
    const ctx = createMockCtx();

    expect(await phase.fn(ctx)).toBe(true);
    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children.map((c) => c.label)).toEqual(["constraints-b"]);
  });

  it("spawns nothing when every repository is already declared", async () => {
    mockParseConstraints.mockReturnValue([
      { repoName: "a", constraints: [{ label: "Lint", command: "make lint" }] },
    ]);
    const phase = phaseFor([{ repoName: "a", worktreePath: "/w/a" }]);
    const ctx = createMockCtx();

    expect(await phase.fn(ctx)).toBe(true);
    expect(ctx.runChildGroup).not.toHaveBeenCalled();
  });

  it("discovers for every repository when the README cannot be read", async () => {
    mockReadReadme.mockRejectedValue(new Error("boom"));
    const phase = phaseFor([{ repoName: "a", worktreePath: "/w/a" }]);
    const ctx = createMockCtx();

    expect(await phase.fn(ctx)).toBe(true);
    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children.map((c) => c.label)).toEqual(["constraints-a"]);
  });

  it("is a no-op without repositories", async () => {
    const phase = phaseFor([]);
    const ctx = createMockCtx();

    expect(await phase.fn(ctx)).toBe(true);
    expect(ctx.runChildGroup).not.toHaveBeenCalled();
  });

  it("reports failure when a child fails", async () => {
    const phase = phaseFor([
      { repoName: "a", worktreePath: "/w/a" },
      { repoName: "b", worktreePath: "/w/b" },
    ]);
    const ctx = createMockCtx({ runChildGroup: vi.fn(async () => [true, false]) });

    expect(await phase.fn(ctx)).toBe(false);
  });
});
