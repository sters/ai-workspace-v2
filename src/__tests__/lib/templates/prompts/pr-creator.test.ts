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

  // The body is read next to the diff, so it carries what the diff cannot show.
  // Without a stated bar the agent explains the whole change end to end.
  it("bounds the description length", () => {
    expect(prompt).toContain("### PR Description Length");
    expect(prompt).toMatch(/\b(20 lines|under a minute)\b/i);
  });

  // The README is inlined as context for the agent, and restating its Goal /
  // Requirements / Acceptance Criteria is the single largest source of padding.
  it("forbids restating the workspace README in the body", () => {
    expect(prompt).toMatch(/README/);
    expect(prompt.toLowerCase()).toMatch(/do not (copy|restate|reproduce)[^.]*readme/);
  });

  // "cover every commit" used to read as "enumerate every commit", which turns a
  // multi-cycle branch's body into a changelog.
  it("asks for one description of the final state rather than a commit log", () => {
    expect(prompt).toMatch(/commit-by-commit|per-commit|changelog/i);
    expect(prompt).not.toContain("Include all commits in summary, not just the latest");
  });

  // The update path re-uses the existing body as its base, so an instruction to
  // reflect "the current full set of changes" grows it once per cycle.
  it("keeps an updated body the same size rather than growing it", () => {
    expect(prompt).toMatch(/replace[^.]*rather than append|not grow/i);
  });

  // A template's own scaffolding is the one thing the agent may not shorten, but
  // a section with nothing to say still costs a line rather than a paragraph.
  it("allows a one-line answer for a template section with nothing substantive", () => {
    expect(prompt).toMatch(/one line/i);
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
