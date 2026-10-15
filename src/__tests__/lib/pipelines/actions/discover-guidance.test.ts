import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { GroupChild, PhaseFunctionContext } from "@/types/pipeline";

vi.mock("@/lib/templates", () => ({
  buildRepoGuidancePrompt: vi.fn((input: { repoName: string }) => `prompt-${input.repoName}`),
}));
vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/repo-guidance.md"),
}));
vi.mock("@/lib/workspace/repo-guidance", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/workspace/repo-guidance")>()),
  locateRepoGuidanceCache: vi.fn(),
  readRepoGuidanceCache: vi.fn(),
  writeRepoGuidanceCache: vi.fn(),
}));

import { buildDiscoverGuidancePhase } from "@/lib/pipelines/actions/discover-guidance";
import {
  locateRepoGuidanceCache,
  readRepoGuidanceCache,
  repoGuidancePath,
  writeRepoGuidanceCache,
} from "@/lib/workspace/repo-guidance";

const mockLocate = vi.mocked(locateRepoGuidanceCache);
const mockReadCache = vi.mocked(readRepoGuidanceCache);
const mockWriteCache = vi.mocked(writeRepoGuidanceCache);

const GUIDANCE = "## Implementation\n\n- `CLAUDE.md` — x\n\n## Review\n\n- `a.md` — y\n";

let wsPath: string;

function createMockCtx(runChildGroup?: PhaseFunctionContext["runChildGroup"]): PhaseFunctionContext {
  return {
    operationId: "test-op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: runChildGroup ?? vi.fn(async (children: GroupChild[]) => children.map(() => true)),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
  };
}

/** A child that does what the prompt asks: writes the guidance file it was pointed at. */
function writingChildren(content = GUIDANCE) {
  return vi.fn(async (children: GroupChild[]) => {
    for (const child of children) {
      const repoName = child.label.replace(/^guidance-/, "");
      const file = repoGuidancePath(wsPath, repoName);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return children.map(() => true);
  });
}

function phaseFor(repos: { repoName: string; worktreePath: string }[]) {
  return buildDiscoverGuidancePhase({ workspace: "ws", wsPath, repos });
}

describe("buildDiscoverGuidancePhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsPath = fs.mkdtempSync(path.join("/tmp", "aiw-discover-guidance-"));
    mockLocate.mockResolvedValue(null);
    mockReadCache.mockResolvedValue(null);
  });
  afterEach(() => {
    fs.rmSync(wsPath, { recursive: true, force: true });
  });

  it("lets the agent write only its own guidance file", async () => {
    const ctx = createMockCtx(writingChildren());
    await phaseFor([{ repoName: "web", worktreePath: "/w/web" }]).fn(ctx);

    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children).toHaveLength(1);
    // No addDirs: those would auto-allow Edit/Write over the whole directory.
    expect(children[0].addDirs).toBeUndefined();
    const file = repoGuidancePath(wsPath, "web");
    expect(children[0].allowedTools).toEqual([`Write(/${file})`, `Edit(/${file})`]);
  });

  it("skips a repository whose guidance this workspace already holds", async () => {
    const file = repoGuidancePath(wsPath, "web");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, GUIDANCE);
    const ctx = createMockCtx(writingChildren());

    expect(await phaseFor([
      { repoName: "web", worktreePath: "/w/web" },
      { repoName: "api", worktreePath: "/w/api" },
    ]).fn(ctx)).toBe(true);

    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children.map((c) => c.label)).toEqual(["guidance-api"]);
  });

  it("copies a cached entry into the workspace instead of discovering", async () => {
    mockLocate.mockResolvedValue({ file: "/cache/web.md", key: "k" });
    mockReadCache.mockResolvedValue(GUIDANCE);
    const ctx = createMockCtx();

    expect(await phaseFor([{ repoName: "web", worktreePath: "/w/web" }]).fn(ctx)).toBe(true);

    expect(ctx.runChildGroup).not.toHaveBeenCalled();
    expect(fs.readFileSync(repoGuidancePath(wsPath, "web"), "utf8")).toBe(GUIDANCE);
  });

  it("caches what the agent wrote, under the key computed before it ran", async () => {
    mockLocate.mockResolvedValue({ file: "/cache/web.md", key: "before" });
    const ctx = createMockCtx(writingChildren());

    await phaseFor([{ repoName: "web", worktreePath: "/w/web" }]).fn(ctx);

    expect(mockWriteCache).toHaveBeenCalledWith({ file: "/cache/web.md", key: "before" }, GUIDANCE);
  });

  it("runs one discovery for worktrees of one checkout and gives each the result", async () => {
    mockLocate.mockResolvedValue({ file: "/cache/web.md", key: "same" });
    const ctx = createMockCtx(writingChildren());

    await phaseFor([
      { repoName: "web", worktreePath: "/w/web" },
      { repoName: "web___admin", worktreePath: "/w/web___admin" },
    ]).fn(ctx);

    const [children] = vi.mocked(ctx.runChildGroup).mock.calls[0];
    expect(children.map((c) => c.label)).toEqual(["guidance-web"]);
    expect(fs.readFileSync(repoGuidancePath(wsPath, "web___admin"), "utf8")).toBe(GUIDANCE);
  });

  it("caches nothing for a child that failed or wrote no file", async () => {
    mockLocate.mockResolvedValue({ file: "/cache/web.md", key: "k" });
    const ctx = createMockCtx(vi.fn(async () => [true]));

    await phaseFor([{ repoName: "web", worktreePath: "/w/web" }]).fn(ctx);

    expect(mockWriteCache).not.toHaveBeenCalled();
  });

  it("succeeds even when discovery fails, so init goes on without guidance", async () => {
    // It runs inside the constraints phase, and a false would retry that too.
    const ctx = createMockCtx(vi.fn(async () => [false]));
    expect(await phaseFor([{ repoName: "web", worktreePath: "/w/web" }]).fn(ctx)).toBe(true);
  });
});
