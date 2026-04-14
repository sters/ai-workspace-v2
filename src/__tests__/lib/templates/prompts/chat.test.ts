import { describe, expect, it } from "vitest";
import { getChatSystemPrompt, buildInitPrompt, getReviewChatSystemPrompt, buildReviewChatPrompt } from "@/lib/templates/prompts/chat";

describe("getChatSystemPrompt", () => {
  it("mentions README.md and TODO", () => {
    const systemPrompt = getChatSystemPrompt();
    expect(systemPrompt).toContain("README.md");
    expect(systemPrompt).toContain("TODO");
  });

  it("instructs not to proactively read files", () => {
    const systemPrompt = getChatSystemPrompt();
    expect(systemPrompt).toContain("Do NOT proactively read");
  });
});

describe("buildInitPrompt", () => {
  const workspaceId = "my-project";
  const workspacePath = "/root/workspace/my-project";

  it("includes the workspace ID", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: "# Test",
      todos: [],
    });
    expect(prompt).toContain('"my-project"');
  });

  it("includes the workspace directory path", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: "# Test",
      todos: [],
    });
    expect(prompt).toContain(workspacePath);
  });

  it("embeds README content", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: "# My Project\nSome description",
      todos: [],
    });
    expect(prompt).toContain("# My Project");
    expect(prompt).toContain("Some description");
  });

  it("shows placeholder when README is missing", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: null,
      todos: [],
    });
    expect(prompt).toContain("(no README.md)");
  });

  it("embeds TODO summary", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: "# Test",
      todos: [
        {
          filename: "TODO-repo.md",
          repoName: "repo",
          items: [
            { text: "Fix bug", status: "pending", indent: 0, children: [] },
            { text: "Done task", status: "completed", indent: 0, children: [] },
          ],
          sections: [],
          completed: 1,
          pending: 1,
          blocked: 0,
          inProgress: 0,
          total: 2,
          progress: 50,
        },
      ],
    });
    expect(prompt).toContain("TODO-repo.md: 1/2 completed");
    expect(prompt).toContain("[ ] Fix bug");
  });

  it("shows placeholder when no TODO files", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: "# Test",
      todos: [],
    });
    expect(prompt).toContain("(no TODO files)");
  });
});

describe("getReviewChatSystemPrompt", () => {
  it("instructs not to proactively read files", () => {
    const systemPrompt = getReviewChatSystemPrompt();
    expect(systemPrompt).toContain("Do NOT proactively read");
  });
});

describe("buildReviewChatPrompt", () => {
  const workspaceId = "my-project";
  const workspacePath = "/root/workspace/my-project";
  const reviewTimestamp = "20260214-235920";

  it("includes the workspace ID and path", async () => {
    const prompt = await buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp, {
      readme: "# Test",
      todos: [],
      reviewSummary: "All good",
    });
    expect(prompt).toContain('"my-project"');
    expect(prompt).toContain(workspacePath);
  });

  it("includes the review timestamp and artifacts path", async () => {
    const prompt = await buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp, {
      readme: "# Test",
      todos: [],
      reviewSummary: "All good",
    });
    expect(prompt).toContain(reviewTimestamp);
    expect(prompt).toContain(`artifacts/reviews/${reviewTimestamp}/`);
  });

  it("embeds review summary", async () => {
    const prompt = await buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp, {
      readme: "# Test",
      todos: [],
      reviewSummary: "Critical: 2, Warnings: 3",
    });
    expect(prompt).toContain("Critical: 2, Warnings: 3");
  });

  it("shows placeholder when review summary is missing", async () => {
    const prompt = await buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp, {
      readme: "# Test",
      todos: [],
      reviewSummary: null,
    });
    expect(prompt).toContain("(no SUMMARY.md found)");
  });
});
