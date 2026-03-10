import { describe, expect, it } from "vitest";
import {
  buildExecutorPrompt,
  buildBatchedExecutorPrompt,
} from "@/lib/templates/prompts/executor";

describe("buildExecutorPrompt", () => {
  it("includes repo name and workspace in output", () => {
    const prompt = buildExecutorPrompt({
      workspaceName: "ws-1",
      repoPath: "github.com/org/my-repo",
      repoName: "my-repo",
      readmeContent: "# My README",
      todoContent: "- [ ] Task 1",
      worktreePath: "/tmp/wt",
      workspacePath: "/tmp/ws",
    });
    expect(prompt).toContain("my-repo");
    expect(prompt).toContain("ws-1");
    expect(prompt).toContain("# My README");
    expect(prompt).toContain("- [ ] Task 1");
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

  it("includes batch number in header", () => {
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 0,
      totalBatches: 3,
      batchTodoContent: "- [ ] Task 1\n- [ ] Task 2",
    });
    expect(prompt).toContain("Batch 1/3");
    expect(prompt).toContain("1 of 3");
  });

  it("includes batch TODO content", () => {
    const batchContent = "- [ ] Task 1\n- [ ] Task 2";
    const prompt = buildBatchedExecutorPrompt({
      ...baseInput,
      batchIndex: 1,
      totalBatches: 2,
      batchTodoContent: batchContent,
    });
    expect(prompt).toContain(batchContent);
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
