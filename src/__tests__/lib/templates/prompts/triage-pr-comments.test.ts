import { describe, it, expect } from "vitest";
import {
  buildTriagePrCommentsInstruction,
  renderValidationForPrompt,
} from "@/lib/templates/prompts/triage-pr-comments";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
import type { PrThreadValidation } from "@/types/pull-request";

const thread = {
  id: "PRRT_kwDOabc",
  repoName: "widgets",
  prUrl: "https://github.com/acme/widgets/pull/42",
  path: "src/cache.ts",
  line: 88,
  commentUrl: "https://github.com/acme/widgets/pull/42#discussion_r1",
  author: "reviewer",
  body: "This early return skips the unlock.",
};

const validation: PrThreadValidation = {
  threadId: "PRRT_kwDOabc",
  repoName: "widgets",
  commentUrl: thread.commentUrl,
  verdict: "valid",
  interpretation: "The reviewer wants the lock released on the error path.",
  reasoning: "cache.ts:88 returns before unlock().",
  recommendation: "Wrap the body in try/finally.",
  evidence: ["src/cache.ts:88"],
  validatedAt: "2026-08-05T00:00:00.000Z",
};

describe("renderValidationForPrompt", () => {
  it("carries the verdict, the reasoning and the evidence", () => {
    const rendered = renderValidationForPrompt(validation);
    expect(rendered).toContain("valid");
    expect(rendered).toContain("The reviewer wants the lock released on the error path.");
    expect(rendered).toContain("Wrap the body in try/finally.");
    expect(rendered).toContain("src/cache.ts:88");
  });

  it("omits an evidence line when there is no evidence", () => {
    expect(renderValidationForPrompt({ ...validation, evidence: [] })).not.toContain("Evidence:");
  });

  it("stays free of server-only imports, since the tab builds this in the browser", async () => {
    const source = await Bun.file("src/lib/templates/prompts/triage-pr-comments.ts").text();
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/\bBun\./);
    expect(source).not.toContain("@/lib/workspace/");
  });
});

describe("buildTriagePrCommentsInstruction", () => {
  const instruction = buildTriagePrCommentsInstruction({ threads: [thread] });

  it("names the repo, the file and the comment url for each thread", () => {
    expect(instruction).toContain("widgets");
    expect(instruction).toContain("src/cache.ts");
    expect(instruction).toContain(thread.commentUrl);
  });

  it("quotes the comment body so the planner does not re-fetch it", () => {
    expect(instruction).toContain("This early return skips the unlock.");
  });

  it("carries the thread node id, which the reply phase joins on", () => {
    expect(instruction).toContain("PRRT_kwDOabc");
  });

  it("requires a row per thread in the PR Review Threads section", () => {
    // Without the row, `create-pr` has nothing to reply to after it pushes: the
    // section is the only record that survives stripCompletedTodoItems.
    expect(instruction).toContain(`## ${PR_REVIEW_THREADS_HEADING}`);
    expect(instruction).toContain("| Thread ID | Comment URL | Summary | TODO item |");
    expect(instruction).toMatch(/verbatim/);
  });

  it("forbids replying or resolving at triage time", () => {
    // The fix does not exist yet, so a reply would speak for work not done.
    expect(instruction).toMatch(/do NOT reply/i);
    expect(instruction).toMatch(/do NOT resolve/i);
  });

  it("scopes the work to the listed threads and nothing else", () => {
    expect(instruction).toMatch(/only the .*threads? listed|listed below.*nothing else/i);
  });

  it("says these threads were already triaged by a human", () => {
    // The distinction from the Address PR Reviews quick-fill: that one judges
    // validity itself. Here a human already decided, so re-litigating it would
    // silently drop work they asked for.
    expect(instruction).toMatch(/already (decided|judged)|a human/i);
  });

  it("tells it not to fetch the whole PR again", () => {
    expect(instruction).toMatch(/gh pr view|re-?fetch|already (below|here)/i);
  });

  it("numbers multiple threads so items can be matched back", () => {
    const multi = buildTriagePrCommentsInstruction({
      threads: [thread, { ...thread, id: "PRRT_kwDOdef", commentUrl: "https://x/#r2", body: "Second" }],
    });
    expect(multi).toContain("### 1.");
    expect(multi).toContain("### 2.");
  });

  it("groups by repo so a multi-repo triage lands in the right TODO file", () => {
    const multi = buildTriagePrCommentsInstruction({
      threads: [thread, { ...thread, id: "PRRT_o", repoName: "gadgets", body: "Other repo" }],
    });
    expect(multi).toContain("gadgets");
    expect(multi).toMatch(/TODO-widgets\.md|repository the thread belongs to/i);
  });

  it("includes a recorded validation verdict when there is one", () => {
    const validated = buildTriagePrCommentsInstruction({
      threads: [thread],
      validations: { [thread.id]: validation },
    });
    expect(validated).toContain("valid");
    expect(validated).toContain("The reviewer wants the lock released on the error path.");
    expect(validated).toContain("Wrap the body in try/finally.");
  });

  it("presents a verdict as prior analysis, not as the plan", () => {
    const validated = buildTriagePrCommentsInstruction({
      threads: [thread],
      validations: { [thread.id]: validation },
    });
    expect(validated).toMatch(/re-?derive|starting point|still (check|verify)/i);
  });

  it("flags an invalid verdict the human triaged anyway rather than hiding it", () => {
    // Triaging past an `invalid` verdict is a legitimate override — the human saw
    // the verdict and chose to act — but the planner should know the tension is
    // there instead of finding a contradiction it cannot explain.
    const validated = buildTriagePrCommentsInstruction({
      threads: [thread],
      validations: { [thread.id]: { ...validation, verdict: "invalid" } },
    });
    expect(validated).toMatch(/invalid/);
    expect(validated).toMatch(/chose to act|overrid|anyway/i);
  });

  it("works with no validations at all — triage without validate is the normal path", () => {
    expect(() => buildTriagePrCommentsInstruction({ threads: [thread] })).not.toThrow();
    expect(instruction).not.toContain("Validation verdict");
  });

  it("returns an empty string for no threads, so callers cannot start empty work", () => {
    expect(buildTriagePrCommentsInstruction({ threads: [] })).toBe("");
  });

  it("survives a thread with no file anchor", () => {
    const unanchored = buildTriagePrCommentsInstruction({
      threads: [{ ...thread, path: null, line: null }],
    });
    expect(unanchored).toContain("PRRT_kwDOabc");
    expect(unanchored).not.toContain("null");
  });
});
