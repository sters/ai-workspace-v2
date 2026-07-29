// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDiscoveryPrompt } from "@/lib/templates/prompts/discovery";
import type { DiscoveryInput } from "@/types/prompts";

describe("buildDiscoveryPrompt", () => {
  const workspace: DiscoveryInput["workspace"] = {
    name: "ws-auth",
    title: "Auth Fixes",
    taskType: "bugfix",
    progress: 80,
    repositories: ["repo-a"],
    readmeContent: "# Auth Fixes\n\nFix authentication bugs in repo-a.",
    todos: [
      { repoName: "repo-a", completed: 4, pending: 1, blocked: 0, total: 5 },
    ],
  };

  it("truncates long result summaries to 800 chars", () => {
    const longSummary = "x".repeat(1000);
    const prompt = buildDiscoveryPrompt({
      workspace,
      operations: [
        {
          type: "execute",
          completedAt: "2026-03-20T10:00:00Z",
          inputs: {},
          resultSummary: longSummary,
        },
      ],
      otherWorkspaceNames: [],
    });
    expect(prompt).not.toContain(longSummary);
    expect(prompt).toContain("x".repeat(800));
  });
});
