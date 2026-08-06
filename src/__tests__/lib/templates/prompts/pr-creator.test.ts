import { describe, it, expect } from "vitest";
import {
  getPRCreatorSystemPrompt,
  buildPRCreatorPrompt,
} from "@/lib/templates/prompts/pr-creator";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
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

  it("keeps the existing push / create / update rules", () => {
    expect(prompt).toContain("gh pr create");
    expect(prompt).toContain("gh pr edit");
    expect(prompt).toContain("Do NOT force-push");
  });

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

  // "未完了ならやらなくていい" — an unfinished, in-progress or blocked item must
  // leave its thread untouched.
  it("leaves threads for incomplete items alone", () => {
    expect(prompt).toContain("- [ ]");
    expect(prompt).toContain("- [~]");
    expect(prompt).toContain("- [!]");
    expect(prompt.toLowerCase()).toMatch(/no reply/);
  });

  // Completed items are deleted from the TODO file between cycles, so absence is
  // the normal signal for "done" by the time create-pr runs.
  it("reads an absent item as complete", () => {
    expect(prompt.toLowerCase()).toMatch(/absent|no longer in the file|deleted/);
  });

  // create-pr can run twice over the same PR (manual re-run, resume); GitHub's
  // own isResolved is the idempotency source, since nothing writes state back.
  it("skips threads GitHub already reports as resolved", () => {
    expect(prompt).toContain("isResolved");
  });

  // Each repo's PR is composed by an independent child that sees only its own
  // diff, so a mandated title is the only thing that can make sibling PRs of one
  // task match. Composing is the fallback, not the rule.
  it("mandates the provided title verbatim for a new PR", () => {
    expect(prompt).toContain("## PR Title");
    expect(prompt).toContain("verbatim");
  });

  // A repo-name suffix would break the byte-identity that makes the titles
  // recognizable as one task, and the PR list already names the repository.
  it("forbids appending the repository name to the mandated title", () => {
    expect(prompt).toMatch(/do not (append|add).*repository name/i);
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
