import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));
vi.mock("@/lib/workspace/helpers", () => ({
  exec: vi.fn(() => ""),
  repoDir: () => "/repos",
  detectBaseBranch: vi.fn(() => "master"),
  remoteBranchExists: vi.fn(() => true),
}));
vi.mock("node:fs", () => {
  const fs = { existsSync: vi.fn(), mkdirSync: vi.fn(), rmSync: vi.fn() };
  return { ...fs, default: fs };
});

import { existsSync } from "node:fs";
import { exec } from "@/lib/workspace/helpers";
import { setupRepository } from "@/lib/pipelines/actions/setup-repository";

const mockExec = vi.mocked(exec);
const mockExists = vi.mocked(existsSync);

const WORKSPACE = "feature-ABC-1-thing-20260101";
const REPO_ABS = "/repos/github.com/acme/repo";
const WS_ABS = `/ws/${WORKSPACE}`;

/** Fetch stderr shaped like git's: the reason comes last, after the ref updates. */
const FETCH_ERROR = [
  "From github.com:acme/repo",
  "   aaaaaaaaaaaa..bbbbbbbbbbbb  master -> origin/master",
  " - [deleted]         (none)     -> origin/gone",
  "error: You're on a case-insensitive filesystem, and the remote you are",
  "trying to fetch from has references that only differ in casing.",
].join("\n");

/**
 * Stand-in for a repository where the branch to be created does not exist yet:
 * `rev-parse --verify` has to fail, or the duplicate-name search never ends.
 */
function defaultExec(cmd: unknown): string {
  if (String(cmd).includes("rev-parse --verify")) {
    throw new Error("fatal: not a valid object name");
  }
  return "";
}

function fetchCalls(): string[] {
  return mockExec.mock.calls
    .map((c) => String(c[0]))
    .filter((cmd) => cmd.includes("fetch --all"));
}

function setup(emitStatus = vi.fn()) {
  return setupRepository(
    WORKSPACE,
    "github.com/acme/repo:dev",
    "master",
    emitStatus,
  );
}

describe("setupRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockImplementation(defaultExec);
    mockExists.mockImplementation((p) => {
      const s = String(p);
      // Post-`worktree add` verification of <worktree>/.git.
      if (s.endsWith("/.git")) return true;
      // The repository is already cloned; the worktree directory is not there yet.
      return s === REPO_ABS || s === WS_ABS;
    });
  });

  it("retries a failed fetch and proceeds once an attempt succeeds", () => {
    let attempts = 0;
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("fetch --all")) {
        attempts++;
        if (attempts === 1) throw new Error("error: cannot lock ref: incorrect old value provided");
      }
      return defaultExec(cmd);
    });

    const result = setup();

    expect(fetchCalls()).toHaveLength(2);
    expect(result.repoPath).toBe("github.com/acme/repo___dev");
    expect(
      mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add")),
    ).toBe(true);
  });

  it("continues with the refs already on disk when every fetch attempt fails", () => {
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("fetch --all")) throw new Error(FETCH_ERROR);
      return defaultExec(cmd);
    });
    const emitStatus = vi.fn();

    const result = setup(emitStatus);

    expect(fetchCalls().length).toBeGreaterThanOrEqual(3);
    expect(result.branchName).toBe("feature/ABC-1-thing-dev");
    expect(
      mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add")),
    ).toBe(true);

    // The warning has to carry git's reason, which is the last line of a long
    // transcript rather than the first.
    const warning = emitStatus.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.startsWith("Warning:"));
    expect(warning).toMatch(/case-insensitive filesystem/);
    expect(warning).toMatch(/continuing with the refs already on disk/);
  });

  it("still fails when the repository cannot be cloned", () => {
    mockExists.mockImplementation((p) => String(p) === WS_ABS);
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("git clone")) throw new Error("fatal: repository not found");
      return defaultExec(cmd);
    });

    expect(() => setup()).toThrow(/repository not found/);
  });
});
