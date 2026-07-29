import { describe, expect, it } from "vitest";
import { getChatSystemPrompt, buildInitPrompt, getReviewChatSystemPrompt, getResearchChatSystemPrompt, buildReviewChatPrompt } from "@/lib/templates/prompts/chat";

describe("getChatSystemPrompt", () => {
  const systemPrompt = getChatSystemPrompt();

  it("spells out the wanted first turn as a positive example", () => {
    // Positive examples steer better than a stack of "Do NOT" lines.
    expect(systemPrompt).toContain('"Ready."');
    expect(systemPrompt).toMatch(/first turn/i);
  });

  it("defers reading, analysis and next-step proposals to the user's request", () => {
    expect(systemPrompt).toMatch(/only (once|when|after) the user asks/i);
    expect(systemPrompt.toLowerCase()).toContain("silent reference");
  });

  it("requires a bare cd as the first Bash call", () => {
    expect(systemPrompt).toMatch(/one Bash call/i);
    expect(systemPrompt).toContain("cd");
    expect(systemPrompt).toMatch(/`&&`/);
  });

  it("keeps the negative guidance to a minimum", () => {
    const doNots = systemPrompt.match(/Do NOT/g) ?? [];
    expect(doNots.length).toBeLessThanOrEqual(1);
  });
});

describe("buildInitPrompt", () => {
  const workspaceId = "my-project";
  const workspacePath = "/root/workspace/my-project";

  it("shows placeholder when README is missing", async () => {
    const prompt = await buildInitPrompt(workspaceId, workspacePath, {
      readme: null,
      todos: [],
    });
    expect(prompt).toContain("(no README.md)");
  });

  it("renders each TODO file as a progress count plus checkbox lines", async () => {
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

describe.each([
  ["review", getReviewChatSystemPrompt(), "review"],
  ["research", getResearchChatSystemPrompt(), "research"],
])("%s chat system prompt", (_name, systemPrompt, topic) => {
  it("asks for a brief acknowledgement of the topic, then a wait", () => {
    expect(systemPrompt).toMatch(/1-2 sentences/);
    expect(systemPrompt).toContain(`${topic} topic`);
  });

  it("ties further tool use to the user's question rather than forbidding it", () => {
    expect(systemPrompt).toMatch(/once the user's question calls for them/i);
  });

  it("still requires the bare cd first", () => {
    expect(systemPrompt).toMatch(/one Bash call/i);
    expect(systemPrompt).toContain("cd");
  });
});

describe("buildReviewChatPrompt", () => {
  const workspaceId = "my-project";
  const workspacePath = "/root/workspace/my-project";
  const reviewTimestamp = "20260214-235920";

  it("includes the review timestamp and artifacts path", async () => {
    const prompt = await buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp, {
      readme: "# Test",
      todos: [],
      reviewSummary: "All good",
    });
    expect(prompt).toContain(reviewTimestamp);
    expect(prompt).toContain(`artifacts/reviews/${reviewTimestamp}/`);
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
