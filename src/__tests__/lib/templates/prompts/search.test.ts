import { describe, expect, it } from "vitest";
import { buildSearchPrompt, DEEP_SEARCH_SCHEMA } from "@/lib/templates/prompts/search";

describe("buildSearchPrompt", () => {
  it("includes the query in the prompt", () => {
    const prompt = buildSearchPrompt("authentication bug", "/workspace");
    expect(prompt).toContain("authentication bug");
  });

  it("includes the workspace path", () => {
    const prompt = buildSearchPrompt("test", "/my/workspace/path");
    expect(prompt).toContain("/my/workspace/path");
  });

  it("mentions README.md files", () => {
    const prompt = buildSearchPrompt("test", "/workspace");
    expect(prompt).toContain("README.md");
  });

  it("mentions TODO files", () => {
    const prompt = buildSearchPrompt("test", "/workspace");
    expect(prompt).toContain("TODO");
  });

  it("returns a non-empty string", () => {
    const prompt = buildSearchPrompt("query", "/path");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("asks for JSON output", () => {
    const prompt = buildSearchPrompt("test", "/workspace");
    expect(prompt).toContain("JSON");
  });
});

describe("DEEP_SEARCH_SCHEMA", () => {
  it("has results array with required fields", () => {
    expect(DEEP_SEARCH_SCHEMA.type).toBe("object");
    expect(DEEP_SEARCH_SCHEMA.properties.results.type).toBe("array");
    const item = DEEP_SEARCH_SCHEMA.properties.results.items;
    expect(item.required).toContain("workspaceName");
    expect(item.required).toContain("title");
    expect(item.required).toContain("excerpts");
  });
});
