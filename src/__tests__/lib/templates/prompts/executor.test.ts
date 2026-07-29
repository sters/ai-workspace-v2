import { describe, expect, it } from "vitest";
import {
  buildBatchedExecutorPrompt,
  getExecutorSystemPrompt,
} from "@/lib/templates/prompts/executor";

describe("getExecutorSystemPrompt", () => {
  it("explicitly forbids creating pull requests", () => {
    const prompt = getExecutorSystemPrompt();
    expect(prompt).toMatch(/do not.*create.*pull request/i);
  });

  it("forbids pushing to remote unconditionally, without an 'if requested' escape hatch", () => {
    const prompt = getExecutorSystemPrompt();
    expect(prompt).toMatch(/do not.*push/i);
    // A conditional ban reads as satisfied by any TODO that mentions a PR, which
    // is exactly what Address-PR-Reviews TODOs look like.
    expect(prompt).not.toMatch(/push[^\n]*unless (explicitly )?requested/i);
  });

  it("forbids inspecting remote PR / CI state", () => {
    const prompt = getExecutorSystemPrompt();
    expect(prompt).toContain("gh pr view");
    expect(prompt).toContain("gh pr checks");
    expect(prompt).toContain("gh run view");
  });
});

describe("buildBatchedExecutorPrompt", () => {
  const baseInput = {
    workspaceName: "ws-1",
    repoPath: "github.com/org/my-repo",
    repoName: "my-repo",
    readmeContent: "# My README",
    todoContent: "- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4",
    worktreePath: "/tmp/wt",
    workspacePath: "/tmp/ws",
  };

  // batchIndex is 0-based; the prompt has to count from 1.
  it("renders the 0-based batch index as a 1-based position", () => {
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 0,
      totalBatches: 3,
      batchTodoContent: "- [ ] Task 1\n- [ ] Task 2",
    });
    expect(prompt).toContain("Batch 1/3");
    expect(prompt).toContain("1 of 3");
  });

  it("includes completed summary when provided", () => {
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 1,
      totalBatches: 2,
      batchTodoContent: "- [ ] Task 3",
      completedSummary: "- [x] Task 1\n- [x] Task 2",
    });
    expect(prompt).toContain("Previously Completed Items");
    expect(prompt).toContain("- [x] Task 1");
    expect(prompt).toContain("- [x] Task 2");
  });

  it("omits completed summary section when not provided", () => {
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 0,
      totalBatches: 2,
      batchTodoContent: "- [ ] Task 1",
    });
    expect(prompt).not.toContain("Previously Completed Items");
  });

  it("instructs to focus only on current batch items", () => {
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 0,
      totalBatches: 2,
      batchTodoContent: "- [ ] Task 1",
    });
    expect(prompt).toContain("Focus only on the items listed");
  });
});
