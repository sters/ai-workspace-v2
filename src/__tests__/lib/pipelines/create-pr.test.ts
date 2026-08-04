import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/config", () => ({
  getWorkspaceDir: () => "/ws",
}));

vi.mock("@/lib/workspace/reader", () => ({
  getReadme: vi.fn(async () => "# README"),
}));

vi.mock("@/lib/parsers/readme", () => ({
  parseReadmeMeta: vi.fn(() => ({ repositories: [] })),
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
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildPRCreatorPrompt } from "@/lib/templates";

const mockListWorkspaceRepos = vi.mocked(listWorkspaceRepos);
const mockBuildPrompt = vi.mocked(buildPRCreatorPrompt);

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
});
