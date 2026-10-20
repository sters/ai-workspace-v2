import { vi, describe, it, expect, beforeEach } from "vitest";

const config = vi.hoisted(() => ({ operations: { fetchIntervalMinutes: 10 } }));
vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
  getConfig: () => config,
}));
vi.mock("@/lib/workspace/helpers", () => ({
  exec: vi.fn(() => ""),
  repoDir: () => "/repos",
  detectBaseBranch: vi.fn(() => "master"),
  remoteBranchExists: vi.fn(() => true),
}));
vi.mock("@/lib/fs", () => ({ pathExists: vi.fn() }));
const files = vi.hoisted(() => new Map<string, string>());
/** mtime (ms) of each path `stat` finds; anything else is ENOENT. */
const mtimes = vi.hoisted(() => new Map<string, number>());
vi.mock("node:fs/promises", () => {
  const fs = {
    mkdir: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
    readFile: vi.fn(async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return text;
    }),
    writeFile: vi.fn(async (p: string, text: string) => { files.set(p, text); }),
    stat: vi.fn(async (p: string) => {
      const mtimeMs = mtimes.get(p);
      if (mtimeMs === undefined) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return { mtimeMs };
    }),
  };
  return { ...fs, default: fs };
});

import { pathExists } from "@/lib/fs";
import { exec, remoteBranchExists } from "@/lib/workspace/helpers";
import { setupRepositories, setupRepository } from "@/lib/pipelines/actions/setup-repository";

const mockExec = vi.mocked(exec);
const mockExists = vi.mocked(pathExists);
const mockRemoteBranchExists = vi.mocked(remoteBranchExists);

const WORKSPACE = "feature-ABC-1-thing-20260101";
const REPO_ABS = "/repos/github.com/acme/repo";
const WS_ABS = `/ws/${WORKSPACE}`;
const README_ABS = `${WS_ABS}/README.md`;

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

  it("checks a PR branch out under the first local name no branch holds, in a worktree or not", async () => {
    // `pr-head` is checked out by another workspace's worktree; `pr-head-2` is
    // left over from a workspace that was deleted, so no worktree lists it.
    const taken = new Set(["refs/heads/pr-head", "refs/heads/pr-head-2"]);
    mockExec.mockImplementation((cmd) => {
      const ref = String(cmd).match(/rev-parse --verify "([^"]+)"/)?.[1];
      if (ref !== undefined) {
        if (taken.has(ref)) return "";
        throw new Error("fatal: not a valid object name");
      }
      return "";
    });

    const result = await setupRepository(WORKSPACE, "github.com/acme/repo", "master", vi.fn(), "pr-head");

    expect(result.branchName).toBe("pr-head-3");
    const add = mockExec.mock.calls.map((c) => String(c[0])).find((c) => c.includes("worktree add"));
    expect(add).toContain(`-b "pr-head-3"`);
    expect(add).toContain(`"origin/pr-head"`);
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

describe("skipping a fetch the clone had a moment ago", () => {
  const FETCH_HEAD = `${REPO_ABS}/.git/FETCH_HEAD`;
  const MINUTE = 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    mtimes.clear();
    config.operations.fetchIntervalMinutes = 10;
    mockExec.mockImplementation(defaultExec);
    mockExists.mockImplementation(async (p) => {
      const s = String(p);
      if (s.endsWith("/.git")) return true;
      return s === REPO_ABS || s === WS_ABS;
    });
  });

  it("does not fetch a clone fetched within the interval, and says so", async () => {
    mtimes.set(FETCH_HEAD, Date.now() - 3 * MINUTE);
    const emitted: string[] = [];

    const [outcome] = await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo" }], (m) => emitted.push(m));

    expect(outcome.ok).toBe(true);
    expect(fetchCalls()).toEqual([]);
    expect(emitted.some((m) => /fetched 3 min ago/.test(m))).toBe(true);
  });

  it("fetches a clone whose last fetch is older than the interval", async () => {
    mtimes.set(FETCH_HEAD, Date.now() - 11 * MINUTE);
    await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo" }], vi.fn());
    expect(fetchCalls()).toHaveLength(1);
  });

  it("fetches a clone that was never fetched", async () => {
    await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo" }], vi.fn());
    expect(fetchCalls()).toHaveLength(1);
  });

  it("always fetches with an interval of 0", async () => {
    config.operations.fetchIntervalMinutes = 0;
    mtimes.set(FETCH_HEAD, Date.now());
    await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo" }], vi.fn());
    expect(fetchCalls()).toHaveLength(1);
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

  // A quick create from the form, one from Slack and an init may each set up a
  // worktree of the same clone at once.
  describe("setups of one clone running at once", () => {
    function slowGit(cmd: unknown) {
      const s = String(cmd);
      if (s.includes("fetch --all") || s.includes("git clone")) return Bun.sleep(20).then(() => "");
      return defaultExec(cmd);
    }

    it("share the fetch already running instead of starting a second one", async () => {
      mockExec.mockImplementation(slowGit);
      const emitted: string[] = [];

      const [first, second] = await Promise.all([
        setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:one" }], vi.fn()),
        setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:two" }], (m) => emitted.push(m)),
      ]);

      expect([...first, ...second].every((o) => o.ok)).toBe(true);
      expect(fetchCalls()).toHaveLength(1);
      expect(emitted.some((m) => /already running/.test(m))).toBe(true);
    });

    it("share a clone in flight, whose second copy would find the directory taken", async () => {
      mockExec.mockImplementation(slowGit);
      mockExists.mockImplementation(async (p) => String(p).endsWith("/.git") || String(p) === WS_ABS);

      await Promise.all([
        setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:one" }], vi.fn()),
        setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:two" }], vi.fn()),
      ]);

      expect(mockExec.mock.calls.filter((c) => String(c[0]).startsWith("git clone"))).toHaveLength(1);
    });

    it("fetch again for a setup that starts after the last fetch finished", async () => {
      await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:one" }], vi.fn());
      await setupRepositories(WORKSPACE, [{ repoPath: "github.com/acme/repo:two" }], vi.fn());

      expect(fetchCalls()).toHaveLength(2);
    });
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

describe("recording the base branch in the README", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
    mockExec.mockImplementation(defaultExec);
    mockRemoteBranchExists.mockImplementation(async (_repo, branch) => branch === "master");
    mockExists.mockImplementation(async (p) => {
      const s = String(p);
      if (s.endsWith("/.git")) return true;
      return s === REPO_ABS || s === "/repos/github.com/acme/other" || s === WS_ABS;
    });
  });

  it("replaces a declared base the repository does not have with the one the worktree was cut from", async () => {
    files.set(README_ABS, [
      "## Repositories",
      "- **dev**: `github.com/acme/repo:dev` (base: `main`)",
      "- **prod**: `github.com/acme/repo:prod` (base: `main`)",
      "- **other**: `github.com/acme/other` (base: `develop`)",
    ].join("\n"));

    const outcomes = await setupRepositories(
      WORKSPACE,
      [
        { repoPath: "github.com/acme/repo:dev", baseBranchOverride: "main" },
        { repoPath: "github.com/acme/repo:prod" },
      ],
      vi.fn(),
    );

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(files.get(README_ABS)).toBe([
      "## Repositories",
      "- **dev**: `github.com/acme/repo:dev` (base: `master`)",
      "- **prod**: `github.com/acme/repo:prod` (base: `master`)",
      "- **other**: `github.com/acme/other` (base: `develop`)",
    ].join("\n"));
  });

  it("does not take a path that merely starts with the set-up one for its line", async () => {
    files.set(README_ABS, [
      "- **repo-tools**: `github.com/acme/repo-tools` (base: `main`)",
      "- **repo**: `github.com/acme/repo` (base: `main`)",
    ].join("\n"));

    await setupRepository(WORKSPACE, "github.com/acme/repo", undefined, vi.fn());

    expect(files.get(README_ABS)).toBe([
      "- **repo-tools**: `github.com/acme/repo-tools` (base: `main`)",
      "- **repo**: `github.com/acme/repo` (base: `master`)",
    ].join("\n"));
  });

  it("sets up the worktree when the workspace has no README", async () => {
    await expect(setupRepository(WORKSPACE, "github.com/acme/repo", undefined, vi.fn()))
      .resolves.toMatchObject({ baseBranch: "master" });
  });
});
