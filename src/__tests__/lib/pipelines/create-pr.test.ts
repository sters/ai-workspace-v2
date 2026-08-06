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
import { parseReadmeMeta } from "@/lib/parsers/readme";
import { buildPRCreatorPrompt } from "@/lib/templates";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockCheckExistingPR = vi.mocked(checkExistingPR);
const mockParseReadmeMeta = vi.mocked(parseReadmeMeta);
const mockBuildPrompt = vi.mocked(buildPRCreatorPrompt);

const meta = (title: string) =>
  ({ title, repositories: [] }) as ReturnType<typeof parseReadmeMeta>;

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

  it("returns a single group phase with one child per repo", async () => {
    const phases = await buildCreatePrPipeline({ workspace: "ws", draft: true });
    expect(phases).toHaveLength(1);
    expect(phases[0].kind).toBe("group");
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

  // The README's `# Task:` heading is the one title the whole workspace shares,
  // so every repo's PR gets the identical string — the children are independent
  // and would otherwise each paraphrase their own diff.
  it("gives every repo the README task title verbatim", async () => {
    mockListWorkspaceRepos.mockReturnValue([
      {
        repoName: "api",
        repoPath: "/repos/api",
        worktreePath: "/repos/api/worktrees/ws",
      },
      {
        repoName: "web",
        repoPath: "/repos/web",
        worktreePath: "/repos/web/worktrees/ws",
      },
    ] as ReturnType<typeof listWorkspaceRepos>);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    const titles = mockBuildPrompt.mock.calls.map((c) => c[0].sharedTitle);
    expect(titles).toEqual([
      "Add pagination to user search API",
      "Add pagination to user search API",
    ]);
  });

  // Reachable through a hand-edited README or `init --only`, where nothing ever
  // rewrote the heading. Mandating "TBD" as a PR title is worse than composing one.
  it.each(["TBD", "Untitled", "  ", "Task: TBD"])(
    "falls back to a composed title when the heading is still %j",
    async (title) => {
      mockParseReadmeMeta.mockReturnValue(meta(title));

      await buildCreatePrPipeline({ workspace: "ws", draft: true });

      expect(mockBuildPrompt.mock.calls[0][0].sharedTitle).toBeUndefined();
    },
  );

  // An existing PR's title is the user's to keep; the update path only retitles
  // when scope shifted, so it must not receive a mandated title at all.
  it("withholds the shared title from a repo that already has a PR", async () => {
    mockCheckExistingPR.mockReturnValue({
      exists: true,
      url: "https://example.com/pull/1",
      title: "Existing",
      body: "body",
    } as ReturnType<typeof checkExistingPR>);

    await buildCreatePrPipeline({ workspace: "ws", draft: true });

    expect(mockBuildPrompt.mock.calls[0][0].sharedTitle).toBeUndefined();
  });
});
