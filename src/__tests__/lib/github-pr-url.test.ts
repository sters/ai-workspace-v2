import { describe, expect, it } from "vitest";
import { parsePrUrl } from "@/lib/github-pr-url";

describe("parsePrUrl", () => {
  it("reads a PR URL into its repository and number", () => {
    expect(parsePrUrl("https://github.com/acme/web/pull/42")).toEqual({
      url: "https://github.com/acme/web/pull/42",
      owner: "acme",
      repo: "web",
      repoPath: "github.com/acme/web",
      prNumber: 42,
    });
  });

  it("accepts the forms a browser tab hands over, and canonicalizes them", () => {
    for (const input of [
      "github.com/acme/web/pull/42",
      "https://github.com/acme/web/pull/42/files",
      "https://github.com/acme/web/pull/42#discussion_r1",
      "https://github.com/acme/web/pull/42?w=1",
      "  https://github.com/acme/web/pull/42  ",
    ]) {
      expect(parsePrUrl(input)?.url).toBe("https://github.com/acme/web/pull/42");
    }
  });

  it("is not a repository path, an alias, or a PR mentioned inside other text", () => {
    expect(parsePrUrl("github.com/acme/web")).toBeNull();
    expect(parsePrUrl("github.com/acme/web:pull")).toBeNull();
    expect(parsePrUrl("see https://github.com/acme/web/pull/42")).toBeNull();
    expect(parsePrUrl("https://github.com/acme/web/pull/")).toBeNull();
    expect(parsePrUrl("https://github.com/acme/web/issues/42")).toBeNull();
  });
});
