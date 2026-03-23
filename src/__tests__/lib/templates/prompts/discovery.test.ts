// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDiscoveryPrompt, DISCOVERY_SCHEMA } from "@/lib/templates/prompts/discovery";
import type { DiscoveryInput } from "@/types/prompts";

describe("buildDiscoveryPrompt", () => {
  const input: DiscoveryInput = {
    workspace: {
      name: "ws-auth",
      title: "Auth Fixes",
      taskType: "bugfix",
      progress: 80,
      repositories: ["repo-a"],
      readmeContent: "# Auth Fixes\n\nFix authentication bugs in repo-a.",
      todos: [
        { repoName: "repo-a", completed: 4, pending: 1, blocked: 0, total: 5 },
      ],
    },
    operations: [
      {
        type: "execute",
        completedAt: "2026-03-20T10:00:00Z",
        inputs: { description: "Fix auth" },
        resultSummary: "Fixed login flow",
      },
      {
        type: "review",
        completedAt: "2026-03-21T10:00:00Z",
        inputs: {},
        resultSummary: "Found 3 issues",
      },
    ],
    otherWorkspaceNames: ["ws-logging", "ws-ci"],
  };

  it("includes workspace metadata in prompt", () => {
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain("ws-auth");
    expect(prompt).toContain("Auth Fixes");
    expect(prompt).toContain("bugfix");
    expect(prompt).toContain("repo-a");
  });

  it("includes README content", () => {
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain("Fix authentication bugs");
  });

  it("includes TODO summary", () => {
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain("4/5 done");
    expect(prompt).toContain("1 pending");
  });

  it("includes operations with inputs and results", () => {
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain("execute");
    expect(prompt).toContain("Fixed login flow");
    expect(prompt).toContain("Fix auth");
  });

  it("includes other workspace names for deduplication", () => {
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain("ws-logging");
    expect(prompt).toContain("ws-ci");
  });

  it("handles empty operations", () => {
    const emptyOps: DiscoveryInput = {
      workspace: input.workspace,
      operations: [],
      otherWorkspaceNames: [],
    };
    const prompt = buildDiscoveryPrompt(emptyOps);
    expect(prompt).toContain("no operations recorded");
  });

  it("truncates long result summaries to 800 chars", () => {
    const longSummary = "x".repeat(1000);
    const longInput: DiscoveryInput = {
      workspace: input.workspace,
      operations: [
        {
          type: "execute",
          completedAt: "2026-03-20T10:00:00Z",
          inputs: {},
          resultSummary: longSummary,
        },
      ],
      otherWorkspaceNames: [],
    };
    const prompt = buildDiscoveryPrompt(longInput);
    expect(prompt).not.toContain(longSummary);
    expect(prompt).toContain("x".repeat(800));
  });
});

describe("DISCOVERY_SCHEMA", () => {
  it("has required suggestions array", () => {
    expect(DISCOVERY_SCHEMA.type).toBe("object");
    expect(DISCOVERY_SCHEMA.required).toContain("suggestions");
    expect(DISCOVERY_SCHEMA.properties.suggestions.type).toBe("array");
  });

  it("suggestion items require title and description", () => {
    const items = DISCOVERY_SCHEMA.properties.suggestions.items;
    expect(items.required).toContain("title");
    expect(items.required).toContain("description");
  });
});
