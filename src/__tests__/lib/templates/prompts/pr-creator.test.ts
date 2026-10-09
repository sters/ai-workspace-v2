import { describe, it, expect } from "vitest";
import {
  getPRCreatorSystemPrompt,
  buildPRCreatorPrompt,
} from "@/lib/templates/prompts/pr-creator";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
import { NO_WORKSPACE_REFERENCES } from "@/lib/templates/prompts/shared";
import type { PRCreatorInput } from "@/types/prompts";

const baseInput: PRCreatorInput = {
  workspaceName: "ws",
  repoPath: "/repos/my-repo",
  repoName: "my-repo",
  baseBranch: "main",
  worktreePath: "/repos/my-repo/worktrees/ws",
  readmeContent: "# README",
  repoChanges: "Branch: feat/x",
  draft: true,
};

describe("getPRCreatorSystemPrompt", () => {
  const prompt = getPRCreatorSystemPrompt();

  it("describes replying to and resolving addressed review threads", () => {
    expect(prompt).toContain(PR_REVIEW_THREADS_HEADING);
    expect(prompt).toContain("addPullRequestReviewThreadReply");
    expect(prompt).toContain("resolveReviewThread");
  });

  // The reply names a commit, so it must not be posted before that commit is on
  // the remote — nor at all if the push failed.
  it("orders the reply after a successful push", () => {
    expect(prompt).toContain("only after the push has succeeded");
    expect(prompt).toContain("If the push failed");
    const pushIdx = prompt.indexOf("only after the push has succeeded");
    const replyIdx = prompt.indexOf("addPullRequestReviewThreadReply");
    expect(pushIdx).toBeLessThan(replyIdx);
  });

  // A repo with no PR template had no fixed structure at all, and the prompt
  // described two: a "standard format" of `## Summary` alone, and a separately
  // named "Related issues" section the worked example never showed. Two shapes
  // is how the section set came out different on every run.
  it("gives the no-template case one fixed body shape", () => {
    expect(prompt).toContain("## Related Resources");
    expect(prompt).not.toContain(`"Related issues" section`);
    expect(prompt).not.toContain("use a standard format");
  });

  // The body is written under the description bar, so the rule has to be next to
  // it rather than somewhere above the git mechanics.
  it("states it alongside the description bar", () => {
    expect(prompt.indexOf("### PR Description: An Overview, Not a Walkthrough")).toBeLessThan(
      prompt.indexOf(NO_WORKSPACE_REFERENCES),
    );
  });
});

describe("buildPRCreatorPrompt", () => {
  it("omits the review-thread section when there is no record", () => {
    const prompt = buildPRCreatorPrompt(baseInput);
    expect(prompt).not.toContain(PR_REVIEW_THREADS_HEADING);
  });

  it("omits the title section when no shared title was resolved", () => {
    const prompt = buildPRCreatorPrompt(baseInput);
    expect(prompt).not.toContain("## PR Title");
  });

  it("renders the shared title as the mandated title", () => {
    const prompt = buildPRCreatorPrompt({
      ...baseInput,
      sharedTitle: "Add pagination to user search API",
    });
    expect(prompt).toContain("## PR Title");
    expect(prompt).toContain("Add pagination to user search API");
  });

  it("asks for a distinguishing qualifier when other worktrees share the repository", () => {
    const prompt = buildPRCreatorPrompt({
      ...baseInput,
      sharedTitle: "Add pagination to user search API",
      sameRepoSiblings: ["my-repo___admin"],
    });
    expect(prompt).toContain("## PR Title");
    expect(prompt).toContain("my-repo___admin");
    expect(prompt).toContain("Add pagination to user search API — <");
  });

  it("asks for a distinguishing title from siblings even with no shared title", () => {
    const prompt = buildPRCreatorPrompt({ ...baseInput, sameRepoSiblings: ["my-repo___admin"] });
    expect(prompt).toContain("my-repo___admin");
  });

  it("says nothing about siblings when updating an existing PR", () => {
    const prompt = buildPRCreatorPrompt({
      ...baseInput,
      existingPR: { url: "u", title: "t", body: "b" },
      sameRepoSiblings: ["my-repo___admin"],
    });
    expect(prompt).not.toContain("my-repo___admin");
  });

  it("renders the recorded threads and the TODO file path", () => {
    const prompt = buildPRCreatorPrompt({
      ...baseInput,
      prReviewThreads: "| PRRT_abc | url | Nil check | **[handler.go]** Add nil check |",
      todoFilePath: "/ws/ws/TODO-my-repo.md",
    });
    expect(prompt).toContain(`## ${PR_REVIEW_THREADS_HEADING}`);
    expect(prompt).toContain("PRRT_abc");
    expect(prompt).toContain("/ws/ws/TODO-my-repo.md");
  });
});
