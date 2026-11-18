// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PhaseFunctionContext, PipelinePhaseFunction } from "@/types/pipeline";

let wsRoot = "";
vi.mock("@/lib/config", () => ({ getWorkspaceDir: () => wsRoot }));

const mockListWorkspaceRepos = vi.fn();
const mockCommit = vi.fn();
vi.mock("@/lib/workspace/git", () => ({
  listWorkspaceRepos: (...a: unknown[]) => mockListWorkspaceRepos(...a),
  commitWorkspaceSnapshot: (...a: unknown[]) => mockCommit(...a),
}));

const mockSetupRepository = vi.fn();
vi.mock("@/lib/pipelines/actions/setup-repository", () => ({
  setupRepository: (...a: unknown[]) => mockSetupRepository(...a),
}));

const mockDiscover = vi.fn(async () => true);
vi.mock("@/lib/pipelines/actions/ensure-repositories", () => ({
  discoverConstraintsForNewRepos: (...a: unknown[]) => mockDiscover(...(a as [])),
}));

import { buildAddRepositoryPipeline } from "@/lib/pipelines/add-repository";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { buildReadmeContent } from "@/lib/templates";

const WS = "feature-widgets";

function ctx(): PhaseFunctionContext {
  return {
    operationId: "op",
    emitStatus: vi.fn(),
    emitResult: vi.fn(),
    emitAsk: vi.fn(),
    setWorkspace: vi.fn(),
    runChild: vi.fn(async () => true),
    runChildGroup: vi.fn(async () => [true]),
    emitTerminal: vi.fn(),
    signal: new AbortController().signal,
    appendPhases: vi.fn(),
  };
}

async function run(input: Parameters<typeof buildAddRepositoryPipeline>[0]) {
  const [phase] = buildAddRepositoryPipeline(input) as PipelinePhaseFunction[];
  const c = ctx();
  return { ok: await phase.fn(c), ctx: c };
}

const readme = () => fs.readFileSync(path.join(wsRoot, WS, "README.md"), "utf-8");

beforeEach(() => {
  vi.clearAllMocks();
  wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aiw-add-repo-"));
  fs.mkdirSync(path.join(wsRoot, WS));
  fs.writeFileSync(path.join(wsRoot, WS, "README.md"), buildReadmeContent("d", "feature", "N/A", "2026-11-18"));
  mockListWorkspaceRepos.mockResolvedValue([
    { repoPath: "github.com/acme/web", repoName: "web", worktreePath: `${wsRoot}/${WS}/github.com/acme/web` },
  ]);
  mockSetupRepository.mockImplementation(async (_ws: string, repo: string, base?: string) => {
    const repoPath = repo.replace(":", "___");
    return {
      repoPath,
      repoName: path.basename(repoPath),
      worktreePath: `${wsRoot}/${WS}/${repoPath}`,
      baseBranch: base ?? "main",
      branchName: "feature/widgets-20261118",
    };
  });
});

afterEach(() => {
  fs.rmSync(wsRoot, { recursive: true, force: true });
});

describe("add-repository pipeline", () => {
  it("refuses a repository that already has a worktree, before setup can replace it", async () => {
    // setupRepository deletes an existing worktree directory to recreate it,
    // which would throw away uncommitted work in it.
    const { ok } = await run({ workspace: WS, repository: "github.com/acme/web" });

    expect(ok).toBe(false);
    expect(mockSetupRepository).not.toHaveBeenCalled();
  });

  it("cuts another worktree of a repository already here under an alias", async () => {
    const { ok } = await run({ workspace: WS, repository: "github.com/acme/web:hotfix", branch: "release/1.2" });

    expect(ok).toBe(true);
    expect(mockSetupRepository).toHaveBeenCalledWith(WS, "github.com/acme/web:hotfix", undefined, expect.any(Function), "release/1.2");
    expect(parseReadmeMeta(readme()).repositories.map((r) => r.path)).toEqual(["github.com/acme/web___hotfix"]);
  });

  it("declares the new worktree in the README before discovering its constraints", async () => {
    let declaredAtDiscovery: string[] = [];
    mockDiscover.mockImplementation(async () => {
      declaredAtDiscovery = parseReadmeMeta(readme()).repositories.map((r) => r.path);
      return true;
    });

    await run({ workspace: WS, repository: "github.com/acme/api", baseBranch: "develop" });

    expect(declaredAtDiscovery).toEqual(["github.com/acme/api"]);
    expect(parseReadmeMeta(readme()).repositories[0].baseBranch).toBe("develop");
    expect(mockDiscover).toHaveBeenCalledWith(
      expect.anything(),
      WS,
      [expect.objectContaining({ repoName: "api", worktreePath: `${wsRoot}/${WS}/github.com/acme/api` })],
    );
  });
});
