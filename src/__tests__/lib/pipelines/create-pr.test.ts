import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => "# README"),
}));

vi.mock("@/lib/parsers/readme", () => ({
  parseReadmeMeta: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  listWorkspaceRepos: vi.fn(),
  detectBaseBranch: vi.fn(() => "main"),
  getRepoChanges: vi.fn(() => ({
    currentBranch: "feat/x",
    changedFiles: "a.ts",
    diffStat: "1 file changed",
    commitLog: "abc Fix",
  })),
  checkExistingPR: vi.fn(() => ({ exists: false })),
  readPRTemplate: vi.fn(() => null),
}));

vi.mock("@/lib/templates", () => ({
  buildPRCreatorPrompt: vi.fn(() => "pr-prompt"),
}));

// The derivation itself is real (see pr-title.test.ts); only the git read is
// replaced, since these cases are about which candidate reaches the prompt.
vi.mock("@/lib/workspace/pr-title", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/pr-title")>()),
  getSoleCommitSubject: vi.fn(() => null),
}));

vi.mock("@/lib/workspace/prompts", () => ({
  ensureSystemPrompt: vi.fn(() => "/mock/prompts/pr-creator.md"),
}));

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

import { buildCreatePrPipeline } from "@/lib/pipelines/create-pr";
import { listWorkspaceRepos, checkExistingPR } from "@/lib/workspace";
import { getSoleCommitSubject } from "@/lib/workspace/pr-title";
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { buildPRCreatorPrompt } from "@/lib/templates";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockCheckExistingPR = vi.mocked(checkExistingPR);
const mockParseReadmeMeta = vi.mocked(parseReadmeMeta);
const mockBuildPrompt = vi.mocked(buildPRCreatorPrompt);
const mockSoleCommit = vi.mocked(getSoleCommitSubject);

const meta = (title: string, ticketId = "") =>
  ({ title, ticketId, repositories: [] }) as ReturnType<typeof parseReadmeMeta>;

const TODO_WITH_THREADS = `# TODO: my-repo

## Fixes

- [ ] **[a.ts]** Do a thing

## PR Review Threads

| Thread ID | Comment URL | Summary | TODO item |
|---|---|---|---|
| PRRT_abc | https://example.com/pull/1#discussion_r1 | Nil check | **[a.ts]** Do a thing |
`;

describe("buildCreatePrPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(false);
    mockFileText.mockResolvedValue("");
    mockParseReadmeMeta.mockReturnValue(meta("Add pagination to user search API"));
    mockCheckExistingPR.mockReturnValue({ exists: false } as ReturnType<typeof checkExistingPR>);
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "my-repo",
        repoPath: "/repos/my-repo",
        worktreePath: "/repos/my-repo/worktrees/ws",
      } as ReturnType<typeof listWorkspaceRepos>[number],
    ]);
  });

  it("passes the recorded review threads and TODO path to the prompt", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue(TODO_WITH_THREADS);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    const input = mockBuildPrompt.mock.calls[0][0];
    expect(input.prReviewThreads).toContain("PRRT_abc");
    expect(input.todoFilePath).toBe("/ws/ws/TODO-my-repo.md");
  });

  it("leaves both fields undefined when the TODO file has no thread record", async () => {
    mockFileExists.mockResolvedValue(true);
    mockFileText.mockResolvedValue("# TODO: my-repo\n\n- [ ] Do a thing\n");

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    const input = mockBuildPrompt.mock.calls[0][0];
    expect(input.prReviewThreads).toBeUndefined();
    expect(input.todoFilePath).toBeUndefined();
  });

  it("tolerates a missing TODO file", async () => {
    mockFileExists.mockResolvedValue(false);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    const input = mockBuildPrompt.mock.calls[0][0];
    expect(input.prReviewThreads).toBeUndefined();
  });

  // The task heading names the workspace's goal, not what one repository's PR
  // changes, so it never becomes a PR title.
  it("does not hand the README task title to the PR as its title", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      { repoName: "api", repoPath: "/repos/api", worktreePath: "/repos/api/worktrees/ws" },
      { repoName: "web", repoPath: "/repos/web", worktreePath: "/repos/web/worktrees/ws" },
    ] as ReturnType<typeof listWorkspaceRepos>);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    expect(mockBuildPrompt.mock.calls.map((c) => c[0].givenTitle)).toEqual([undefined, undefined]);
  });

  it("uses each branch's sole commit subject, ticket bracketed on", async () => {
    mockParseReadmeMeta.mockReturnValue(meta("Add pagination to user search API", "ABC-123"));
    mockSoleCommit.mockReturnValueOnce("Tweak the search query");

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    expect(mockSoleCommit).toHaveBeenCalledWith("/repos/my-repo/worktrees/ws", "main");
    expect(mockBuildPrompt.mock.calls[0][0].givenTitle).toBe("[ABC-123] Tweak the search query");
  });

  // The agent composes the title then, and the ticket shape check stays here
  // rather than being re-decided by every child.
  it("passes the validated ticket for a composed title", async () => {
    mockParseReadmeMeta.mockReturnValue(meta("Add pagination", "ABC-123."));

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    const input = mockBuildPrompt.mock.calls[0][0];
    expect(input.givenTitle).toBeUndefined();
    expect(input.ticketRef).toBe("ABC-123");
  });

  it("passes no ticket when the field is not shaped like an ID", async () => {
    mockParseReadmeMeta.mockReturnValue(meta("Add pagination", "N/A"));

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    expect(mockBuildPrompt.mock.calls[0][0].ticketRef).toBeUndefined();
  });

  // Worktrees of one clone open PRs in one repository, where an identical title
  // leaves the PR list unreadable. Siblings are found across the whole workspace,
  // so a run narrowed to one worktree still knows about the others.
  it("names the other worktrees of the same clone, even when narrowed to one", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      { repoName: "api", repoPath: "github.com/acme/api", worktreePath: "/ws/ws/github.com/acme/api" },
      { repoName: "web", repoPath: "github.com/acme/web", worktreePath: "/ws/ws/github.com/acme/web" },
      { repoName: "web___admin", repoPath: "github.com/acme/web___admin", worktreePath: "/ws/ws/github.com/acme/web___admin" },
    ] as ReturnType<typeof listWorkspaceRepos>);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });
    const siblings = Object.fromEntries(
      mockBuildPrompt.mock.calls.map((c) => [c[0].repoName, c[0].sameRepoSiblings]),
    );
    expect(siblings).toEqual({ api: undefined, web: ["web___admin"], web___admin: ["web"] });

    mockBuildPrompt.mockClear();
    await buildCreatePrPipeline({ workspace: "ws", draft: true, repository: "web___admin" });
    expect(mockBuildPrompt.mock.calls.map((c) => c[0].sameRepoSiblings)).toEqual([["web"]]);
  });

  // An existing PR's title is the user's to keep; the update path only retitles
  // when scope shifted, so it must not receive a mandated title at all.
  it("withholds the given title from a repo that already has a PR", async () => {
    mockCheckExistingPR.mockReturnValue({
      exists: true,
      url: "https://example.com/pull/1",
      title: "Existing",
      body: "body",
    } as ReturnType<typeof checkExistingPR>);

    mockSoleCommit.mockReturnValueOnce("Tweak the search query");

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    expect(mockBuildPrompt.mock.calls[0][0].givenTitle).toBeUndefined();
  });
});
