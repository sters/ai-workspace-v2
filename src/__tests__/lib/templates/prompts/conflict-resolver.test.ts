import { describe, it, expect } from "vitest";
import {
  buildConflictResolverPrompt,
  CONFLICT_RESOLUTION_SCHEMA,
  getConflictResolverSystemPrompt,
} from "@/lib/templates/prompts/conflict-resolver";
import { SCOPE_DISCIPLINE } from "@/lib/templates/prompts/shared";

const system = getConflictResolverSystemPrompt();

describe("getConflictResolverSystemPrompt", () => {
  // The deterministic side checks the staged content for leftover markers before
  // anything reaches the pull request. A resolver that commits skips that check.
  it("forbids committing and pushing, and says which phase does it", () => {
    expect(system).toMatch(/Do NOT commit, push/);
    expect(system).toMatch(/merge --abort/);
    expect(system).toMatch(/commits it and pushes/);
  });

  it("states which side of the merge is which", () => {
    expect(system).toContain("MERGE_HEAD");
    expect(system).toMatch(/`ours`/);
    expect(system).toMatch(/`theirs`/);
  });

  it("requires every conflict marker to be gone, including on a one-side resolution", () => {
    expect(system).toContain("diff --name-only --diff-filter=U");
    expect(system).toMatch(/took one side wholesale/);
  });

  // A conflict is routinely a symptom of a rename or a moved function, and
  // resolving inside the markers alone yields a file that merges and does not work.
  it("sends the agent outside the hunk", () => {
    expect(system).toMatch(/renamed a symbol|moved a function/);
  });

  it("keeps a lock file off the text-merge path without switching package managers", () => {
    expect(system).toMatch(/never hand-merge/);
    expect(system).toMatch(/do NOT substitute a different package manager/i);
  });

  // The phase rolls the merge back and reports, which costs a rerun. A guessed
  // resolution reaches someone else's PR looking finished.
  it("makes an unresolvable conflict a wanted answer", () => {
    expect(system).toMatch(/leave that file unresolved and state the question/);
  });

  it("says the repositories' own checks are not what runs here", () => {
    expect(system).toMatch(/not running the repository's lint \/ test \/ build/);
  });

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

describe("CONFLICT_RESOLUTION_SCHEMA", () => {
  it("requires both halves of the answer", () => {
    expect(CONFLICT_RESOLUTION_SCHEMA.required).toEqual([
      "resolvedFiles",
      "unresolvedFiles",
      "summary",
    ]);
  });

  it("offers a side for a resolution that is neither side verbatim", () => {
    expect(CONFLICT_RESOLUTION_SCHEMA.properties.resolvedFiles.items.properties.side.enum)
      .toContain("rewritten");
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

  it("repeats the commit/push prohibition where the answer is described", () => {
    // The system prompt states it, but this is the last thing read before acting.
    expect(buildConflictResolverPrompt(input)).toMatch(/Do not commit and do not push/);
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
