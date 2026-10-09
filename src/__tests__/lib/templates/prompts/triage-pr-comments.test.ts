import { describe, it, expect } from "vitest";
import {
  buildTriagePrCommentsInstruction,
  renderValidationForPrompt,
  type TriageCiFailure,
} from "@/lib/templates/prompts/triage-pr-comments";
import { PR_REVIEW_THREADS_HEADING } from "@/lib/parsers/todo";
import type { PrThreadValidation } from "@/types/pull-request";

const thread = {
  id: "PRRT_kwDOabc",
  kind: "review-thread" as const,
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

const conversationComment = {
  id: "IC_kwDOxyz",
  kind: "comment" as const,
  repoName: "widgets",
  prUrl: "https://github.com/acme/widgets/pull/42",
  path: null,
  line: null,
  commentUrl: "https://github.com/acme/widgets/pull/42#issuecomment-3",
  author: "lead",
  body: "Please update the changelog too.",
};

describe("buildTriagePrCommentsInstruction for comments outside the diff", () => {
  it("quotes the comment and says where on the PR it was written", () => {
    const instruction = buildTriagePrCommentsInstruction({ threads: [conversationComment] });
    expect(instruction).toContain("Please update the changelog too.");
    expect(instruction).toContain(conversationComment.commentUrl);
    expect(instruction).toMatch(/PR conversation/);
  });

  it("names a review body by its state", () => {
    const instruction = buildTriagePrCommentsInstruction({
      threads: [{ ...conversationComment, id: "PRR_kwDO1", kind: "review", reviewState: "CHANGES_REQUESTED" }],
    });
    expect(instruction).toMatch(/review summary \(CHANGES_REQUESTED\)/i);
  });

  it("asks for no PR Review Threads row, since there is no thread to reply in or resolve", () => {
    // `create-pr` replies with addPullRequestReviewThreadReply and resolves with
    // resolveReviewThread — both reject an IssueComment or a review id.
    const instruction = buildTriagePrCommentsInstruction({ threads: [conversationComment] });
    expect(instruction).not.toContain("| Thread ID | Comment URL | Summary | TODO item |");
    expect(instruction).not.toMatch(/Thread ID: `IC_/);
    expect(instruction).toMatch(/no `## PR Review Threads` row/);
    expect(instruction).toMatch(/do NOT reply/i);
  });

  it("keeps the row for the review threads selected alongside one", () => {
    const instruction = buildTriagePrCommentsInstruction({ threads: [thread, conversationComment] });
    expect(instruction).toContain("| Thread ID | Comment URL | Summary | TODO item |");
    expect(instruction).toContain("Thread ID: `PRRT_kwDOabc`");
    expect(instruction).toMatch(/no `## PR Review Threads` row/);
  });
});

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

  it("says nothing about CI when only threads were selected", () => {
    expect(instruction).not.toMatch(/Failing CI checks/);
  });

  describe("a direction the human wrote on the thread", () => {
    const note = "Options A, B or C. A looks best; if there's a better one, use that.";
    const directed = buildTriagePrCommentsInstruction({
      threads: [{ ...thread, note }],
      validations: { [thread.id]: validation },
    });

    it("quotes the note under the thread it belongs to", () => {
      const section = directed.slice(directed.indexOf("### 1."));
      expect(section).toContain(note);
    });

    it("puts the note ahead of the prior validation's recommendation", () => {
      // The human wrote the note after reading the verdict, so where the two
      // disagree the note is the later decision.
      expect(directed.indexOf(note)).toBeLessThan(directed.indexOf("Prior validation"));
      expect(directed).toMatch(/outranks the prior validation/i);
    });

    it("adds no direction block to a thread without a note", () => {
      expect(instruction).not.toMatch(/Direction from the human/);
      expect(
        buildTriagePrCommentsInstruction({ threads: [{ ...thread, note: "  \n " }] }),
      ).not.toMatch(/Direction from the human/);
    });

    it("cannot be closed early by a code fence inside the note", () => {
      const fenced = buildTriagePrCommentsInstruction({
        threads: [{ ...thread, note: "Like this:\n```ts\nfinally { unlock(); }\n```" }],
      });
      expect(fenced).toContain("````\nLike this:");
    });
  });
});

const ciFailure: TriageCiFailure = {
  repoName: "widgets",
  prUrl: "https://github.com/acme/widgets/pull/42",
  name: "lint",
  url: "https://github.com/acme/widgets/actions/runs/1/job/2",
  excerpt: "src/cache.ts:88:3  error  'lock' is assigned but never used",
  truncated: false,
};

describe("buildTriagePrCommentsInstruction — failing CI checks", () => {
  const instruction = buildTriagePrCommentsInstruction({ ciFailures: [ciFailure] });

  it("names the check, the repo and the logs url", () => {
    expect(instruction).toContain("lint");
    expect(instruction).toContain("widgets");
    expect(instruction).toContain(ciFailure.url!);
  });

  it("inlines the log excerpt, because nothing downstream may re-fetch it", () => {
    // The updater has no `gh` grant and the executor's prompt forbids `gh run
    // view`, so an item that only names the job is not actionable.
    expect(instruction).toContain("'lock' is assigned but never used");
  });

  it("says plainly when the log could not be read, with the reason", () => {
    const noLog = buildTriagePrCommentsInstruction({
      ciFailures: [
        {
          ...ciFailure,
          excerpt: null,
          reason: "Not a GitHub Actions check — its log lives on the external CI",
        },
      ],
    });
    expect(noLog).toMatch(/No log could be read/i);
    expect(noLog).toContain("external CI");
    expect(noLog).not.toContain("null");
  });

  it("marks a truncated excerpt as a tail so an absent earlier error is expected", () => {
    const long = buildTriagePrCommentsInstruction({
      ciFailures: [{ ...ciFailure, truncated: true }],
    });
    expect(long).toMatch(/tail|earlier lines/i);
  });

  it("numbers checks apart from threads so items trace back unambiguously", () => {
    const both = buildTriagePrCommentsInstruction({
      threads: [thread],
      ciFailures: [ciFailure, { ...ciFailure, name: "test" }],
    });
    expect(both).toContain("### 1.");
    expect(both).toContain("### C1.");
    expect(both).toContain("### C2.");
  });

  it("covers both kinds in one instruction when both are selected", () => {
    const both = buildTriagePrCommentsInstruction({ threads: [thread], ciFailures: [ciFailure] });
    expect(both).toContain("PRRT_kwDOabc");
    expect(both).toContain("'lock' is assigned but never used");
    // The thread record is still required — the comment still gets a reply.
    expect(both).toContain(`## ${PR_REVIEW_THREADS_HEADING}`);
  });

  it("skips the thread-record section when only checks were selected", () => {
    expect(instruction).not.toContain("| Thread ID | Comment URL | Summary | TODO item |");
  });

  it("carries a direction written on a check, which can settle the flake question", () => {
    const note = "This is the known flaky snapshot; record it, do not fix it.";
    const directed = buildTriagePrCommentsInstruction({ ciFailures: [{ ...ciFailure, note }] });
    expect(directed.slice(directed.indexOf("### C1."))).toContain(note);
    expect(directed).toMatch(/outranks your own reading of the log/i);
  });

  it("returns an empty string when neither kind was selected", () => {
    expect(buildTriagePrCommentsInstruction({})).toBe("");
    expect(buildTriagePrCommentsInstruction({ threads: [], ciFailures: [] })).toBe("");
  });
});
