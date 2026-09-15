import { describe, expect, it } from "vitest";
import {
  getChatSystemPrompt,
  buildInitPrompt,
  getReviewChatSystemPrompt,
  buildReviewChatPrompt,
  getResearchChatSystemPrompt,
  buildResearchChatPrompt,
  getTaskChatSystemPrompt,
  buildTaskChatPrompt,
} from "@/lib/templates/prompts/chat";
import { DERIVED_NAME_MAX_CHARS } from "@/lib/naming";

/**
 * What is deliberately not tested here: that a prompt contains the sentences it
 * was written with. Such a test restates the diff that introduced it, passes
 * for a prompt saying the opposite as long as the keyword survives, and can
 * only fail when someone removes the behavior on purpose — in the same edit
 * that would remove the test. It also taxes every harmless rewording.
 *
 * What is left is what can break by accident: paths and inputs the builders
 * compute, invariants that span the four variants, and the two properties
 * these prompts have been observed to drift against.
 */

const workspaceId = "my-project";
const workspacePath = "/root/workspace/my-project";
const reviewTimestamp = "20260214-235920";

describe("chat system prompts", () => {
  const variants = {
    chat: getChatSystemPrompt(),
    "research-chat": getResearchChatSystemPrompt(),
    "review-chat": getReviewChatSystemPrompt(),
    "task-chat": getTaskChatSystemPrompt(),
  };

  it("closes every variant with the same on-demand-reading fragment", () => {
    // Shared wording rather than a per-variant paraphrase, and a new variant
    // that forgets it fails here: whatever a first turn pre-loads is a snapshot
    // of files an operation may be rewriting while the conversation is open.
    const tails = Object.values(variants).map((p) => p.trim().split("\n\n").at(-1));
    expect(new Set(tails).size).toBe(1);
  });

  it("ends the first turn in a wait everywhere except the task variant", () => {
    // The one difference between the four, and the reason the shared first-turn
    // block takes `afterReads` as a parameter: its fixed text put "then wait
    // for the user" at the end of the task prompt, outranking the system
    // prompt's "start on it".
    const waiting = Object.entries(variants)
      .filter(([, prompt]) => /wait for the user/i.test(prompt))
      .map(([name]) => name);
    expect(waiting).toEqual(["chat", "research-chat", "review-chat"]);
  });

  it("keeps the plain chat's negative guidance to a minimum", () => {
    // A positive example of the wanted first turn steers better than a stack of
    // prohibitions, so this is a guard against growth by accretion.
    expect((variants.chat.match(/Do NOT/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("quotes the heading cap that the derived workspace name truncates to", () => {
    // The task variant rewrites the `# Task:` heading, which a new PR takes
    // verbatim as its title. Moving the constant alone would leave the prompt
    // quoting the old number.
    expect(variants["task-chat"]).toContain(`${DERIVED_NAME_MAX_CHARS} characters`);
  });
});

describe("built opening prompts", () => {
  it("points the init prompt at the workspace it was handed", () => {
    const prompt = buildInitPrompt(workspaceId, workspacePath);
    expect(prompt).toContain(`cd ${workspacePath}`);
    expect(prompt).toContain(`${workspacePath}/README.md`);
    expect(prompt).toContain(`${workspacePath}/TODO-*.md`);
    expect(prompt).toContain(`${workspacePath}/artifacts/`);
  });

  it("composes the review session's paths from its timestamp", () => {
    const prompt = buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp);
    expect(prompt).toContain(
      `${workspacePath}/artifacts/reviews/${reviewTimestamp}/SUMMARY.md`,
    );
    expect(prompt).toContain(`${workspacePath}/README.md`);
  });

  it("composes the research summary's path", () => {
    const prompt = buildResearchChatPrompt(workspaceId, workspacePath);
    expect(prompt).toContain(`${workspacePath}/artifacts/research/summary.md`);
    expect(prompt).toContain(`${workspacePath}/README.md`);
  });

  it("hands the task over verbatim, newlines included", () => {
    // The positional argument is the visible first message in the browser
    // terminal, so this has to read as the user's own wording.
    const task = "fix the login crash\nthe token refresh path 500s";
    expect(buildTaskChatPrompt(workspaceId, workspacePath, task)).toContain(task);
  });

  it.each([
    ["init", () => buildInitPrompt(workspaceId, workspacePath)],
    ["review", () => buildReviewChatPrompt(workspaceId, workspacePath, reviewTimestamp)],
    ["research", () => buildResearchChatPrompt(workspaceId, workspacePath)],
    ["task", () => buildTaskChatPrompt(workspaceId, workspacePath, "fix the login crash")],
  ])("keeps the %s prompt a set of pointers rather than an embedded corpus", (_name, build) => {
    // The README body and a computed TODO progress table used to be inlined
    // here, which both dumped the README into the browser terminal and pinned a
    // snapshot of files an operation rewrites.
    expect(build().length).toBeLessThan(1200);
  });
});
