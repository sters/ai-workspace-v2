import { describe, expect, it } from "vitest";
import { SELECTED_REPOS_HEADING, withSelectedRepositories } from "@/lib/task-description";

describe("withSelectedRepositories", () => {
  it("appends the ticked repositories as one list under the heading", () => {
    expect(
      withSelectedRepositories("Add retry logic", [
        "github.com/acme/web",
        "github.com/acme/api",
      ]),
    ).toBe(
      `Add retry logic\n\n${SELECTED_REPOS_HEADING}\n- github.com/acme/web\n- github.com/acme/api`,
    );
  });

  it("leaves a description with nothing ticked exactly as it was typed", () => {
    expect(withSelectedRepositories("Add retry logic", [])).toBe("Add retry logic");
  });

  it("does not turn a blank description into a request made of repositories", () => {
    // The start buttons are disabled on an empty description, and a repository
    // list is not something to start a run from.
    expect(withSelectedRepositories("   \n ", ["github.com/acme/web"])).toBe("");
  });

  it("keeps the typed description's own blank lines but not its trailing ones", () => {
    expect(withSelectedRepositories("line one\n\nline two\n\n", ["github.com/acme/web"])).toBe(
      `line one\n\nline two\n\n${SELECTED_REPOS_HEADING}\n- github.com/acme/web`,
    );
  });
});
