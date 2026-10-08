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
vi.mock("@/lib/fs", () => ({ pathExists: vi.fn() }));
vi.mock("node:fs/promises", () => {
  const fs = { mkdir: vi.fn(async () => {}), rm: vi.fn(async () => {}) };
  return { ...fs, default: fs };
});

import { pathExists } from "@/lib/fs";
import { exec } from "@/lib/workspace/helpers";
import { setupRepositories, setupRepository } from "@/lib/pipelines/actions/setup-repository";

const mockExec = vi.mocked(exec);
const mockExists = vi.mocked(pathExists);

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

function revParseCalls(): string[] {
  return mockExec.mock.calls
    .map((c) => String(c[0]))
    .filter((cmd) => cmd.includes("rev-parse --verify"));
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
  beforeEach(async () => {
    vi.clearAllMocks();
    mockExec.mockImplementation(defaultExec);
    mockExists.mockImplementation(async (p) => {
      const s = String(p);
      // Post-`worktree add` verification of <worktree>/.git.
      if (s.endsWith("/.git")) return true;
      // The repository is already cloned; the worktree directory is not there yet.
      return s === REPO_ABS || s === WS_ABS;
    });
  });

  it("retries a failed fetch and proceeds once an attempt succeeds", async () => {
    let attempts = 0;
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("fetch --all")) {
        attempts++;
        if (attempts === 1) throw new Error("error: cannot lock ref: incorrect old value provided");
      }
      return defaultExec(cmd);
    });

    const result = await setup();

    expect(fetchCalls()).toHaveLength(2);
    expect(result.repoPath).toBe("github.com/acme/repo___dev");
    expect(
      mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add")),
    ).toBe(true);
  });

  it("continues with the refs already on disk when every fetch attempt fails", async () => {
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("fetch --all")) throw new Error(FETCH_ERROR);
      return defaultExec(cmd);
    });
    const emitStatus = vi.fn();

    const result = await setup(emitStatus);

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

  it("gives up on the suffix search and takes a timestamped name when every name reads as taken", async () => {
    // A `rev-parse --verify` that never fails: what a broken git looks like, and
    // what an over-permissive test mock looks like. The search must not be the
    // thing that decides when to stop.
    mockExec.mockImplementation(() => "");
    const emitStatus = vi.fn();

    const result = await setup(emitStatus);

    expect(revParseCalls().length).toBeLessThan(300);
    expect(result.branchName).toMatch(/^feature\/ABC-1-thing-dev-\d{14}$/);
    expect(
      mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add")),
    ).toBe(true);
    const warning = emitStatus.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.startsWith("Warning:"));
    expect(warning).toMatch(/reported as taken/);
  });

  it("still fails when the repository cannot be cloned", async () => {
    mockExists.mockImplementation(async (p) => String(p) === WS_ABS);
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("git clone")) throw new Error("fatal: repository not found");
      return defaultExec(cmd);
    });

    await expect(setup()).rejects.toThrow(/repository not found/);
  });
});

describe("setupRepositories", () => {
  const ALIASES = ["a-dev", "a-prod", "b-dev", "b-prod", "c-dev", "c-prod"];

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockImplementation(defaultExec);
    mockExists.mockImplementation(async (p) => {
      const s = String(p);
      if (s.endsWith("/.git")) return true;
      return s === REPO_ABS || s === "/repos/github.com/acme/other" || s === WS_ABS;
    });
  });

  it("fetches each clone once however many worktrees are cut from it", async () => {
    const outcomes = await setupRepositories(
      WORKSPACE,
      [
        ...ALIASES.map((a) => ({ repoPath: `github.com/acme/repo:${a}` })),
        { repoPath: "github.com/acme/other" },
      ],
      vi.fn(),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(fetchCalls()).toEqual([
      `git -C "${REPO_ABS}" fetch --all --prune`,
      `git -C "/repos/github.com/acme/other" fetch --all --prune`,
    ]);
  });

  it("checks out worktrees of one clone concurrently while creating their branches one at a time", async () => {
    let addsInFlight = 0;
    let maxAdds = 0;
    let checkoutsInFlight = 0;
    let maxCheckouts = 0;
    mockExec.mockImplementation(async (cmd) => {
      const s = String(cmd);
      if (s.includes("worktree add")) {
        addsInFlight++;
        maxAdds = Math.max(maxAdds, addsInFlight);
        await Bun.sleep(5);
        addsInFlight--;
        return "";
      }
      if (s.includes("reset --hard")) {
        checkoutsInFlight++;
        maxCheckouts = Math.max(maxCheckouts, checkoutsInFlight);
        await Bun.sleep(20);
        checkoutsInFlight--;
        return "";
      }
      return defaultExec(cmd);
    });

    const outcomes = await setupRepositories(
      WORKSPACE,
      ALIASES.map((a) => ({ repoPath: `github.com/acme/repo:${a}` })),
      vi.fn(),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    // Two `worktree add -b` on one clone race on `.git/config` when they record
    // the new branch's upstream.
    expect(maxAdds).toBe(1);
    expect(maxCheckouts).toBeGreaterThan(1);
    expect(
      mockExec.mock.calls.filter((c) => String(c[0]).includes("worktree add --no-checkout")),
    ).toHaveLength(ALIASES.length);
  });

  it("reports a failed worktree in its own slot and still sets up the rest, in input order", async () => {
    mockExec.mockImplementation((cmd) => {
      const s = String(cmd);
      if (s.includes("worktree add") && s.includes("b-dev")) throw new Error("fatal: invalid reference");
      return defaultExec(cmd);
    });

    const outcomes = await setupRepositories(
      WORKSPACE,
      ALIASES.map((a) => ({ repoPath: `github.com/acme/repo:${a}` })),
      vi.fn(),
    );

    expect(outcomes.map((o) => [o.repoPath, o.ok])).toEqual(
      ALIASES.map((a) => [`github.com/acme/repo:${a}`, a !== "b-dev"]),
    );
    const failed = outcomes.find((o) => !o.ok);
    expect(failed && !failed.ok && String(failed.error)).toMatch(/invalid reference/);
  });

  it("fails every worktree of a clone that cannot be cloned, without trying to cut them", async () => {
    mockExists.mockImplementation(async (p) => String(p) === WS_ABS || String(p).endsWith("/.git"));
    mockExec.mockImplementation((cmd) => {
      if (String(cmd).includes("git clone")) throw new Error("fatal: repository not found");
      return defaultExec(cmd);
    });

    const outcomes = await setupRepositories(
      WORKSPACE,
      [{ repoPath: "github.com/acme/repo:x" }, { repoPath: "github.com/acme/repo:y" }],
      vi.fn(),
    );

    expect(outcomes.every((o) => !o.ok)).toBe(true);
    expect(mockExec.mock.calls.filter((c) => String(c[0]).includes("git clone"))).toHaveLength(1);
    expect(mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add"))).toBe(false);
  });

  it("starts no further worktree once the signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const outcomes = await setupRepositories(
      WORKSPACE,
      ALIASES.map((a) => ({ repoPath: `github.com/acme/repo:${a}` })),
      vi.fn(),
      { signal: controller.signal },
    );

    expect(outcomes.every((o) => !o.ok)).toBe(true);
    expect(mockExec.mock.calls.some((c) => String(c[0]).includes("worktree add"))).toBe(false);
  });
});
