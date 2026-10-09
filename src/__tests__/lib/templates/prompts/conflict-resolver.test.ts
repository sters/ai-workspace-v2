import { describe, it, expect } from "vitest";
import {
  buildConflictResolverPrompt,
  getConflictResolverSystemPrompt,
} from "@/lib/templates/prompts/conflict-resolver";
import { SCOPE_DISCIPLINE } from "@/lib/templates/prompts/shared";

const system = getConflictResolverSystemPrompt();

describe("getConflictResolverSystemPrompt", () => {
  it("carries the shared scope rule and the single-worktree cd convention", () => {
    expect(system).toContain(SCOPE_DISCIPLINE);
    expect(system).toMatch(/first Bash tool call MUST be `cd` alone/);
  });

  it("renders the search fragment after the cd rule, not before it", () => {
    expect(system.indexOf("### Working Directory")).toBeLessThan(
      system.indexOf("### Searching the Repository"),
    );
  });
});

describe("buildConflictResolverPrompt", () => {
  const input = {
    workspaceName: "task-1",
    repoName: "widgets",
    repoPath: "github.com/acme/widgets",
    worktreePath: "/ws/task-1/github.com/acme/widgets",
    branch: "feature/widget-cache",
    baseBranch: "main",
    prUrl: "https://github.com/acme/widgets/pull/42",
    prTitle: "Add widget cache",
    conflictedFiles: ["src/cache.ts", "src/index.ts"],
  };

  it("names the worktree, both branches and every conflicted file", () => {
    const prompt = buildConflictResolverPrompt(input);
    expect(prompt).toContain("/ws/task-1/github.com/acme/widgets");
    expect(prompt).toContain("feature/widget-cache");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("`src/cache.ts`");
    expect(prompt).toContain("`src/index.ts`");
    expect(prompt).toContain("https://github.com/acme/widgets/pull/42");
  });

  it("still renders without a pull request URL", () => {
    const prompt = buildConflictResolverPrompt({ ...input, prUrl: undefined, prTitle: undefined });
    expect(prompt).toContain("## Conflicted Files");
    expect(prompt).not.toContain("## Pull Request:");
  });

  it("points at git's own list when the file list is empty", () => {
    const prompt = buildConflictResolverPrompt({ ...input, conflictedFiles: [] });
    expect(prompt).toContain("--diff-filter=U");
  });
});
