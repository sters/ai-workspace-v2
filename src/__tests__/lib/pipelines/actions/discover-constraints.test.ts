import { vi, describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
vi.mock("@/lib/workspace/repo-constraints-cache", async (importActual) => ({
  appendRepoConstraints: (await importActual<typeof import("@/lib/workspace/repo-constraints-cache")>())
    .appendRepoConstraints,
  locateRepoConstraintsCache: vi.fn(),
  readRepoConstraintsCache: vi.fn(),
  writeRepoConstraintsCache: vi.fn(),
}));

import { buildDiscoverConstraintsPhase } from "@/lib/pipelines/actions/discover-constraints";
import { readWorkspaceReadme, parseConstraints } from "@/lib/parsers/readme";
import {
  locateRepoConstraintsCache,
  readRepoConstraintsCache,
  writeRepoConstraintsCache,
} from "@/lib/workspace/repo-constraints-cache";

const mockReadReadme = vi.mocked(readWorkspaceReadme);
const mockParseConstraints = vi.mocked(parseConstraints);
const mockLocate = vi.mocked(locateRepoConstraintsCache);
const mockReadCache = vi.mocked(readRepoConstraintsCache);
const mockWriteCache = vi.mocked(writeRepoConstraintsCache);

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
    mockLocate.mockReturnValue(null);
    mockReadCache.mockReturnValue(null);
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

  describe("constraints cache", () => {
    const LINT = [{ label: "Lint", command: "make lint" }];

    function entryFor(worktreePath: string) {
      return { file: `/cache/${path.basename(worktreePath)}.md`, key: `key-${worktreePath}` };
    }

    it("writes a cached repository's block into the README instead of spawning discovery", async () => {
      const wsPath = fs.mkdtempSync(path.join(os.tmpdir(), "discover-cache-"));
      try {
        const readmePath = path.join(wsPath, "README.md");
        fs.writeFileSync(readmePath, "# Task: x\n\n## Repository Constraints\n\n## Related Resources\n");
        mockReadReadme.mockImplementation(async () => ({
          content: fs.readFileSync(readmePath, "utf8"),
          meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
        }));
        mockLocate.mockImplementation((wt) => entryFor(wt));
        mockReadCache.mockImplementation((entry) => (entry.file === "/cache/a.md" ? LINT : null));

        const phase = buildDiscoverConstraintsPhase({
          workspace: "ws",
          wsPath,
          repos: [
            { repoName: "a", worktreePath: "/w/a" },
            { repoName: "b", worktreePath: "/w/b" },
          ],
        });
        const ctx = createMockCtx();

        expect(await phase.fn(ctx)).toBe(true);
        const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
        expect(children.map((c) => c.label)).toEqual(["constraints-b"]);
        expect(fs.readFileSync(readmePath, "utf8")).toBe(
          "# Task: x\n\n## Repository Constraints\n\n### a\n\n- Lint: `make lint`\n\n## Related Resources\n",
        );
      } finally {
        fs.rmSync(wsPath, { recursive: true, force: true });
      }
    });

    it("spawns nothing when every repository is cached", async () => {
      const wsPath = fs.mkdtempSync(path.join(os.tmpdir(), "discover-cache-"));
      try {
        fs.writeFileSync(path.join(wsPath, "README.md"), "# Task: x\n");
        mockReadReadme.mockResolvedValue({
          content: "# Task: x\n",
          meta: { title: "t", taskType: "feature", ticketId: "", date: "", repositories: [] },
        });
        mockLocate.mockImplementation((wt) => entryFor(wt));
        mockReadCache.mockReturnValue(LINT);

        const phase = buildDiscoverConstraintsPhase({
          workspace: "ws",
          wsPath,
          repos: [{ repoName: "a", worktreePath: "/w/a" }],
        });
        const ctx = createMockCtx();

        expect(await phase.fn(ctx)).toBe(true);
        expect(ctx.runChildGroup).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(wsPath, { recursive: true, force: true });
      }
    });

    it("caches what a successful child wrote, under the key computed before it ran", async () => {
      mockLocate.mockImplementation((wt) => entryFor(wt));
      // First read is the already-declared check; the second is after discovery.
      mockParseConstraints
        .mockReturnValueOnce([])
        .mockReturnValue([
          { repoName: "a", constraints: LINT },
          { repoName: "b", constraints: [{ label: "Test", command: "go test ./..." }] },
        ]);
      const phase = phaseFor([
        { repoName: "a", worktreePath: "/w/a" },
        { repoName: "b", worktreePath: "/w/b" },
      ]);
      const ctx = createMockCtx({ runChildGroup: vi.fn(async () => [true, false]) });

      expect(await phase.fn(ctx)).toBe(false);
      expect(mockWriteCache).toHaveBeenCalledTimes(1);
      expect(mockWriteCache).toHaveBeenCalledWith(entryFor("/w/a"), LINT);
    });

    it("caches nothing for a repository outside the managed clones", async () => {
      mockParseConstraints.mockReturnValueOnce([]).mockReturnValue([
        { repoName: "a", constraints: LINT },
      ]);
      const phase = phaseFor([{ repoName: "a", worktreePath: "/w/a" }]);
      const ctx = createMockCtx();

      expect(await phase.fn(ctx)).toBe(true);
      expect(mockWriteCache).not.toHaveBeenCalled();
    });
  });
});
