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

  // A conversation comment or review summary has no thread: it is answered with a
  // PR comment and settled by hiding it as resolved, the closest GitHub offers.
  it("answers a recorded conversation comment and hides it as resolved", () => {
    expect(prompt).toContain("gh pr comment");
    expect(prompt).toContain("minimizeComment");
    expect(prompt).toContain("classifier:RESOLVED");
    expect(prompt.indexOf("gh pr comment")).toBeLessThan(prompt.indexOf("minimizeComment"));
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

  it("asks for a title composed from this PR's diff when none is given", () => {
    const prompt = buildPRCreatorPrompt(baseInput);
    expect(prompt).toContain("## PR Title");
    expect(prompt).not.toContain("verbatim");
  });

  it("renders the given title as the mandated title", () => {
    const prompt = buildPRCreatorPrompt({ ...baseInput, givenTitle: "Tweak the search query" });
    expect(prompt).toContain("## PR Title");
    expect(prompt).toContain("Tweak the search query");
    expect(prompt).toContain("verbatim");
  });

  it("has a composed title open with the ticket", () => {
    const prompt = buildPRCreatorPrompt({ ...baseInput, ticketRef: "ABC-123" });
    expect(prompt).toContain("`[ABC-123] `");
  });

  it("asks a composed title to tell itself apart from sibling worktrees' PRs", () => {
    const prompt = buildPRCreatorPrompt({ ...baseInput, sameRepoSiblings: ["my-repo___admin"] });
    expect(prompt).toContain("my-repo___admin");
  });

  it("has no title section when updating an existing PR", () => {
    const prompt = buildPRCreatorPrompt({
      ...baseInput,
      existingPR: { url: "u", title: "t", body: "b" },
    });
    expect(prompt).not.toContain("## PR Title");
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
