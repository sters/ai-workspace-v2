import { describe, expect, it } from "vitest";
import { parseAnalysisResultText } from "@/lib/workspace/setup";
import { sanitizeSlug } from "@/lib/workspace/helpers";

describe("parseAnalysisResultText", () => {
  it("parses valid JSON structured output", () => {
    const json = JSON.stringify({
      taskType: "bugfix",
      slug: "fix-login-redirect",
      ticketId: "PROJ-123",
      repositories: ["github.com/org/repo1", "github.com/org/repo2"],
    });

    const result = parseAnalysisResultText(json, "fallback description");
    expect(result).toEqual({
      taskType: "bugfix",
      slug: "fix-login-redirect",
      ticketId: "PROJ-123",
      repositories: ["github.com/org/repo1", "github.com/org/repo2"],
    });
  });

  it("returns fallback when jsonText is undefined", () => {
    const result = parseAnalysisResultText(undefined, "my task description");
    expect(result).toEqual({
      taskType: "feature",
      slug: "my-task-description",
      ticketId: "",
      repositories: [],
    });
  });

  it("returns fallback when jsonText is empty string", () => {
    const result = parseAnalysisResultText("", "fallback");
    expect(result).toEqual({
      taskType: "feature",
      slug: "fallback",
      ticketId: "",
      repositories: [],
    });
  });

  it("returns fallback when jsonText is invalid JSON", () => {
    const result = parseAnalysisResultText("not json at all", "my fallback");
    expect(result).toEqual({
      taskType: "feature",
      slug: "my-fallback",
      ticketId: "",
      repositories: [],
    });
  });

  it("uses fallback taskType when missing", () => {
    const json = JSON.stringify({
      slug: "some-slug",
      ticketId: "",
      repositories: [],
    });
    const result = parseAnalysisResultText(json, "desc");
    expect(result.taskType).toBe("feature");
  });

  it("uses sanitizeSlug fallback when slug is empty", () => {
    const json = JSON.stringify({
      taskType: "research",
      slug: "",
      ticketId: "",
      repositories: [],
    });
    const result = parseAnalysisResultText(json, "my description");
    // sanitizeSlug("") returns "workspace" as its own default
    expect(result.slug).toBe("workspace");
  });

  it("sanitizes slug value", () => {
    const json = JSON.stringify({
      taskType: "feature",
      slug: "My Feature With Spaces",
      ticketId: "",
      repositories: [],
    });
    const result = parseAnalysisResultText(json, "desc");
    expect(result.slug).toBe("my-feature-with-spaces");
  });

  it("handles repositories not being an array", () => {
    const json = JSON.stringify({
      taskType: "feature",
      slug: "test",
      ticketId: "",
      repositories: "not-an-array",
    });
    const result = parseAnalysisResultText(json, "desc");
    expect(result.repositories).toEqual([]);
  });
});

describe("sanitizeSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(sanitizeSlug("My Feature Name")).toBe("my-feature-name");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeSlug("foo---bar")).toBe("foo-bar");
  });

  it("trims leading/trailing hyphens", () => {
    expect(sanitizeSlug("-foo-bar-")).toBe("foo-bar");
  });

  it("returns 'workspace' for empty result", () => {
    expect(sanitizeSlug("")).toBe("workspace");
    expect(sanitizeSlug("!!!")).toBe("workspace");
  });

  it("truncates to maxLength", () => {
    const long = "a".repeat(100);
    expect(sanitizeSlug(long, 10).length).toBeLessThanOrEqual(10);
  });
});
