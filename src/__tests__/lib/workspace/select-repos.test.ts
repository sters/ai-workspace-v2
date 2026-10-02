import { describe, expect, it } from "vitest";
import { selectRepos } from "@/lib/workspace/select-repos";

const repos = [
  { repoPath: "github.com/acme/api", repoName: "api", worktreePath: "/w/api" },
  { repoPath: "github.com/acme/web", repoName: "web", worktreePath: "/w/web" },
  { repoPath: "github.com/acme/web", repoName: "web___admin", worktreePath: "/w/web___admin" },
];

describe("selectRepos", () => {
  it("returns every repository with no filter", () => {
    expect(selectRepos(repos, {})).toEqual(repos);
  });

  it("matches the single-repo filter by path, which selects every worktree of it", () => {
    expect(selectRepos(repos, { repository: "github.com/acme/web" }).map((r) => r.repoName)).toEqual([
      "web",
      "web___admin",
    ]);
  });

  it("intersects the repository set with the single-repo filter rather than replacing it", () => {
    const selected = selectRepos(repos, {
      repository: "github.com/acme/web",
      repositories: ["api", "web___admin"],
    });
    expect(selected.map((r) => r.repoName)).toEqual(["web___admin"]);
  });

  it("selects nothing for an empty set", () => {
    expect(selectRepos(repos, { repositories: [] })).toEqual([]);
  });
});
