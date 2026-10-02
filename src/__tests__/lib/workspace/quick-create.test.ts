// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SetupRepositoryResult } from "@/types/pipeline";
import type { PrBranchInfo, PrUrlInfo } from "@/lib/workspace/pr-url";

const mockSetupWorkspace = vi.fn();
const mockCommitWorkspaceSnapshot = vi.fn();
const mockListAllRepositories = vi.fn(() => []);

vi.mock("@/lib/workspace/setup", () => ({
  setupWorkspace: (...a: unknown[]) => mockSetupWorkspace(...a),
}));

vi.mock("@/lib/workspace/git", () => ({
  commitWorkspaceSnapshot: (...a: unknown[]) => mockCommitWorkspaceSnapshot(...a),
  listAllRepositories: () => mockListAllRepositories(),
}));

import { createQuickWorkspace, fillQuickReadme, type QuickCreateDeps } from "@/lib/workspace/quick-create";
import { parseConstraints, parseReadmeMeta } from "@/lib/parsers/readme";
import { buildReadmeContent } from "@/lib/templates";

const WS_NAME = "bugfix-login-crash-20260911";

function repoResult(repoPath: string, baseBranch = "main"): SetupRepositoryResult {
  return {
    repoPath,
    repoName: path.basename(repoPath),
    worktreePath: `/ws/${WS_NAME}/${repoPath}`,
    baseBranch,
    branchName: "bugfix/login-crash-20260911",
  };
}

const WEB_PR = "https://github.com/acme/web/pull/42";

function pr(overrides: Partial<PrBranchInfo> = {}): PrBranchInfo {
  return {
    headBranch: "feature/widget",
    baseBranch: "develop",
    repoPath: "github.com/acme/web",
    prUrl: WEB_PR,
    isFork: false,
    title: "Add the widget",
    body: "It renders on the settings page.",
    ...overrides,
  };
}

/** A workspace directory as `setupWorkspace` leaves it: template README, no TODO. */
function stageWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quick-create-"));
  fs.writeFileSync(
    path.join(dir, "README.md"),
    buildReadmeContent("fix the crash", "bugfix", "N/A", "2026-09-11"),
    "utf-8",
  );
  return dir;
}

beforeEach(() => {
  mockSetupWorkspace.mockReset();
  mockCommitWorkspaceSnapshot.mockReset();
});

describe("fillQuickReadme", () => {
  it("writes a Repositories section the README parser reads back", () => {
    const filled = fillQuickReadme(buildReadmeContent("d", "bugfix", "N/A", "2026-09-11"), {
      title: "login crash",
      repositories: [
        repoResult("github.com/acme/web"),
        repoResult("github.com/acme/api", "master"),
      ],
    });

    const meta = parseReadmeMeta(filled);
    expect(meta.title).toBe("login crash");
    expect(meta.repositories).toEqual([
      { alias: "web", path: "github.com/acme/web", baseBranch: "main" },
      { alias: "api", path: "github.com/acme/api", baseBranch: "master" },
    ]);
  });

  it("declares an aliased worktree in the `:alias` form the setup step accepts", () => {
    const filled = fillQuickReadme(buildReadmeContent("d", "bugfix", "N/A", "2026-09-11"), {
      title: "t",
      repositories: [repoResult("github.com/acme/web___variant-a")],
    });

    expect(filled).toContain("`github.com/acme/web:variant-a`");
    // The parser normalizes it back to the worktree-directory form.
    expect(parseReadmeMeta(filled).repositories[0].path).toBe("github.com/acme/web___variant-a");
  });

  it("keeps the contract sections as the template left them", () => {
    const filled = fillQuickReadme(buildReadmeContent("d", "bugfix", "N/A", "2026-09-11"), {
      title: "t",
      repositories: [repoResult("github.com/acme/web")],
    });

    expect(filled).toContain("## Goal\n");
    expect(filled).toContain("## Acceptance Criteria\n");
    expect(filled).toContain("## Repository Constraints\n");
    // Nothing invented: the Goal section still holds only its template comment.
    const goal = filled.slice(filled.indexOf("## Goal"), filled.indexOf("## Non-Goal"));
    expect(goal.replace(/<!--[\s\S]*?-->/g, "").trim()).toBe("## Goal");
  });

  it("says so when no worktree was created", () => {
    const filled = fillQuickReadme(buildReadmeContent("d", "bugfix", "N/A", "2026-09-11"), {
      title: "t",
      repositories: [],
    });

    expect(parseReadmeMeta(filled).repositories).toEqual([]);
    expect(filled).toMatch(/## Repositories\n\n<!--[^>]*no worktree/i);
  });

  it("appends the section when the README has no Repositories heading", () => {
    const filled = fillQuickReadme("# Task: TBD\n\n## Goal\n\nship it\n", {
      title: "t",
      repositories: [repoResult("github.com/acme/web")],
    });

    expect(filled).toContain("## Goal\n\nship it");
    expect(parseReadmeMeta(filled).repositories).toHaveLength(1);
  });

  it("collapses a multi-line title into one heading line", () => {
    const filled = fillQuickReadme("# Task: TBD\n", {
      title: "  login crash\nsecond line  ",
      repositories: [],
    });

    expect(filled.split("\n")[0]).toBe("# Task: login crash");
  });
});

describe("createQuickWorkspace", () => {
  it("creates worktrees for every selected repository and records them in the README", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });
    const setupRepository = vi.fn((_ws: string, repo: string) => repoResult(repo));

    const result = await createQuickWorkspace(
      {
        name: "login crash",
        taskType: "bugfix",
        repositories: ["github.com/acme/web", "github.com/acme/api"],
        note: "fix the crash",
      },
      { setupRepository },
    );

    expect(mockSetupWorkspace).toHaveBeenCalledWith("bugfix", "fix the crash", undefined, "login crash");
    expect(setupRepository.mock.calls.map((c) => c[1])).toEqual([
      "github.com/acme/web",
      "github.com/acme/api",
    ]);
    expect(result.workspace).toBe(WS_NAME);
    expect(result.problems).toEqual([]);

    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
    expect(parseReadmeMeta(readme).repositories.map((r) => r.path)).toEqual([
      "github.com/acme/web",
      "github.com/acme/api",
    ]);
    expect(mockCommitWorkspaceSnapshot).toHaveBeenCalledTimes(1);
    expect(mockCommitWorkspaceSnapshot.mock.calls[0][0]).toBe(WS_NAME);
  });

  it("declares the cached constraints of the repositories that have them", async () => {
    // Nothing on this path discovers constraints, so without the cache a
    // review of this workspace runs no lint/test/build at all.
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });
    const lint = [{ label: "Lint", command: "make lint" }];

    await createQuickWorkspace(
      { name: "n", taskType: "bugfix", repositories: ["github.com/acme/web", "github.com/acme/api"] },
      {
        setupRepository: vi.fn((_ws: string, repo: string) => repoResult(repo)),
        cachedConstraints: vi.fn((worktreePath: string) =>
          worktreePath.endsWith("/web") ? lint : null,
        ),
      } as unknown as QuickCreateDeps,
    );

    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
    expect(parseConstraints(readme)).toEqual([{ repoName: "web", constraints: lint }]);
  });

  it("titles the README with the typed name and keeps the note as the request", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });

    await createQuickWorkspace(
      { name: "ログイン時のクラッシュ", taskType: "bugfix", repositories: [], note: "fix the crash" },
      { setupRepository: vi.fn() },
    );

    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
    expect(readme.split("\n")[0]).toBe("# Task: ログイン時のクラッシュ");
    expect(readme).toContain("fix the crash");
  });

  it("names the workspace from the note when no name was typed", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });

    await createQuickWorkspace(
      {
        taskType: "bugfix",
        repositories: [],
        note: "Fix the login crash\nthe refresh path 500s instead of retrying",
      },
      { setupRepository: vi.fn() },
    );

    // The slug comes from the first line; the note stays the request in full.
    const [, description, , preGeneratedSlug] = mockSetupWorkspace.mock.calls[0];
    expect(preGeneratedSlug).toBe("Fix the login crash");
    expect(description).toBe(
      "Fix the login crash\nthe refresh path 500s instead of retrying",
    );

    const readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
    expect(readme.split("\n")[0]).toBe("# Task: Fix the login crash");
  });

  it("reports a repository that failed and still sets up the others", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });
    const setupRepository = vi.fn((_ws: string, repo: string) => {
      if (repo === "github.com/acme/api") throw new Error("no such remote");
      return repoResult(repo);
    });

    const result = await createQuickWorkspace(
      {
        name: "login crash",
        taskType: "bugfix",
        repositories: ["github.com/acme/web", "github.com/acme/api", "github.com/acme/infra"],
      },
      { setupRepository },
    );

    expect(result.repositories.map((r) => r.repoPath)).toEqual([
      "github.com/acme/web",
      "github.com/acme/infra",
    ]);
    expect(result.problems).toEqual([
      { repository: "github.com/acme/api", error: expect.stringContaining("no such remote") },
    ]);
    // The README declares only the worktrees that exist — a declared repository
    // with no worktree makes every later phase report it as missing.
    const declared = parseReadmeMeta(fs.readFileSync(path.join(dir, "README.md"), "utf-8"));
    expect(declared.repositories.map((r) => r.path)).toEqual([
      "github.com/acme/web",
      "github.com/acme/infra",
    ]);
    expect(mockCommitWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  });

  it("writes no TODO file and no templates — the plan is the caller's own", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });

    await createQuickWorkspace(
      { name: "n", taskType: "bugfix", repositories: ["github.com/acme/web"] },
      { setupRepository: vi.fn((_ws: string, repo: string) => repoResult(repo)) },
    );

    expect(fs.readdirSync(dir)).toEqual(["README.md"]);
  });

  it("falls back to the name as the request when no note was given", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });

    await createQuickWorkspace(
      { name: "login crash", taskType: "feature", repositories: [] },
      { setupRepository: vi.fn() },
    );

    expect(mockSetupWorkspace).toHaveBeenCalledWith("feature", "login crash", undefined, "login crash");
  });

  it("collects each repository's setup output as a log, tagged by repository", async () => {
    const dir = stageWorkspace();
    mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });

    const result = await createQuickWorkspace(
      { name: "n", taskType: "bugfix", repositories: ["github.com/acme/web"] },
      {
        setupRepository: vi.fn((_ws: string, repo: string, _base: string | undefined, emit: (m: string) => void) => {
          emit("Base branch: main");
          return repoResult(repo);
        }),
      },
    );

    expect(result.log).toEqual(["[github.com/acme/web] Base branch: main"]);
  });

  describe("a PR URL among the repositories", () => {
    function stage() {
      const dir = stageWorkspace();
      mockSetupWorkspace.mockResolvedValue({ workspaceName: WS_NAME, workspacePath: dir });
      return dir;
    }

    it("checks out the PR's own branch, off the PR's base", async () => {
      stage();
      const setupRepository = vi.fn((_ws: string, repo: string) => repoResult(repo, "develop"));

      const result = await createQuickWorkspace(
        { name: "n", taskType: "review", repositories: [`${WEB_PR}/files`] },
        { setupRepository, resolvePullRequest: () => pr() },
      );

      expect(setupRepository).toHaveBeenCalledWith(
        WS_NAME,
        "github.com/acme/web",
        "develop",
        expect.any(Function),
        "feature/widget",
      );
      expect(result.pullRequests).toEqual([
        { url: WEB_PR, repoPath: "github.com/acme/web", headBranch: "feature/widget" },
      ]);
    });

    it("names the workspace from the PR title and records the PR as the request", async () => {
      const dir = stage();

      await createQuickWorkspace(
        { taskType: "review", repositories: [WEB_PR] },
        {
          setupRepository: vi.fn((_ws: string, repo: string) => repoResult(repo)),
          resolvePullRequest: () => pr(),
        },
      );

      const [, description, , preGeneratedSlug] = mockSetupWorkspace.mock.calls[0];
      expect(preGeneratedSlug).toBe("Add the widget");
      expect(description).toContain(WEB_PR);
      expect(description).toContain("It renders on the settings page.");
      const readme = fs.readFileSync(path.join(dir, "README.md"), "utf-8");
      expect(readme.split("\n")[0]).toBe("# Task: Add the widget");
    });

    it("keeps the note ahead of the PR in the request, and its name over the title", async () => {
      stage();

      await createQuickWorkspace(
        { taskType: "feature", repositories: [WEB_PR], note: "Address the review comments" },
        {
          setupRepository: vi.fn((_ws: string, repo: string) => repoResult(repo)),
          resolvePullRequest: () => pr(),
        },
      );

      const [, description, , preGeneratedSlug] = mockSetupWorkspace.mock.calls[0];
      expect(preGeneratedSlug).toBe("Address the review comments");
      expect(description.indexOf("Address the review comments")).toBe(0);
      expect(description).toContain(WEB_PR);
    });

    it("lets the PR supersede a plain entry for the same repository", async () => {
      stage();
      const setupRepository = vi.fn((_ws: string, repo: string) => repoResult(repo));

      await createQuickWorkspace(
        {
          name: "n",
          taskType: "review",
          repositories: ["github.com/acme/web", WEB_PR, "github.com/acme/web:second"],
        },
        { setupRepository, resolvePullRequest: () => pr() },
      );

      // An aliased entry is a separate worktree directory, so it stays.
      expect(setupRepository.mock.calls.map((c) => [c[1], c[4]])).toEqual([
        ["github.com/acme/web", "feature/widget"],
        ["github.com/acme/web:second", undefined],
      ]);
    });

    it("refuses a second PR of the same repository rather than replacing the first worktree", async () => {
      stage();
      const setupRepository = vi.fn((_ws: string, repo: string) => repoResult(repo));
      const other = "https://github.com/acme/web/pull/43";

      const result = await createQuickWorkspace(
        { name: "n", taskType: "review", repositories: [WEB_PR, other] },
        {
          setupRepository,
          resolvePullRequest: (info: PrUrlInfo) =>
            pr({ prUrl: info.url, headBranch: `branch-${info.prNumber}` }),
        },
      );

      expect(setupRepository).toHaveBeenCalledTimes(1);
      expect(result.problems).toEqual([
        { repository: other, error: expect.stringMatching(/already/i) },
      ]);
    });

    it("reports a fork PR and one gh could not read, and sets up the rest", async () => {
      stage();
      const setupRepository = vi.fn((_ws: string, repo: string) => repoResult(repo));
      const fork = "https://github.com/acme/api/pull/7";
      const unreadable = "https://github.com/acme/infra/pull/8";

      const result = await createQuickWorkspace(
        { name: "n", taskType: "review", repositories: [fork, unreadable, "github.com/acme/tools"] },
        {
          setupRepository,
          resolvePullRequest: (info: PrUrlInfo) => {
            if (info.url === unreadable) throw new Error("gh: not found");
            return pr({ prUrl: info.url, repoPath: info.repoPath, isFork: true });
          },
        },
      );

      expect(setupRepository.mock.calls.map((c) => c[1])).toEqual(["github.com/acme/tools"]);
      expect(result.pullRequests).toEqual([]);
      expect(result.problems).toEqual([
        { repository: fork, error: expect.stringMatching(/fork/i) },
        { repository: unreadable, error: expect.stringContaining("gh: not found") },
      ]);
    });

    it("creates nothing when the only thing to name it by was a PR that could not be read", async () => {
      await expect(
        createQuickWorkspace(
          { taskType: "review", repositories: [WEB_PR] },
          {
            setupRepository: vi.fn(),
            resolvePullRequest: () => {
              throw new Error("gh: not found");
            },
          },
        ),
      ).rejects.toThrow(/gh: not found/);
      expect(mockSetupWorkspace).not.toHaveBeenCalled();
    });
  });
});
