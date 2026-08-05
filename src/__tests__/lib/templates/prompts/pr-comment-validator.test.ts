import { describe, it, expect } from "vitest";
import {
  PR_COMMENT_VALIDATION_SCHEMA,
  buildPrCommentValidatorPrompt,
  getPrCommentValidatorSystemPrompt,
} from "@/lib/templates/prompts/pr-comment-validator";

const input = {
  workspaceName: "feature-cache",
  repoName: "widgets",
  repoPath: "github.com/acme/widgets",
  worktreePath: "/ws/feature-cache/widgets",
  prUrl: "https://github.com/acme/widgets/pull/42",
  prTitle: "Add widget cache",
  baseBranch: "main",
  thread: {
    id: "PRRT_kwDOabc",
    isResolved: false,
    isOutdated: false,
    path: "src/cache.ts",
    line: 88,
    comments: [
      {
        url: "https://github.com/acme/widgets/pull/42#discussion_r1",
        author: "reviewer",
        body: "This early return skips the unlock.",
        createdAt: "2026-08-04T10:00:00Z",
      },
    ],
  },
};

describe("getPrCommentValidatorSystemPrompt", () => {
  const prompt = getPrCommentValidatorSystemPrompt();

  it("frames the deliverable as understanding, not a fix", () => {
    expect(prompt).toMatch(/do NOT (change|modify|edit)/i);
    expect(prompt).toContain("Read-Only");
  });

  it("forbids replying to or resolving the thread", () => {
    // The reply belongs to the phase that pushes: a reply names a commit, and at
    // validate time no commit exists. Same rule the triage instruction carries.
    expect(prompt).toMatch(/do NOT (reply|respond)/i);
    expect(prompt).toMatch(/resolve/i);
  });

  it("defines the three verdicts it is allowed to return", () => {
    expect(prompt).toContain("**valid**");
    expect(prompt).toContain("**invalid**");
    expect(prompt).toContain("**unclear**");
  });

  it("requires the verdict to rest on code, not on the reviewer's authority", () => {
    expect(prompt).toMatch(/read out of the code/i);
    expect(prompt).toMatch(/seniority|authority|because a reviewer said/i);
  });

  it("sends a question the code cannot settle to unclear rather than guessing", () => {
    // This agent runs precisely because a human could not tell. Picking a side to
    // look decisive is the one failure that makes the button worthless.
    expect(prompt).toMatch(/unclear/);
    expect(prompt).toMatch(/what would settle it/i);
  });

  it("carries the canonical worktree cd rule", () => {
    expect(prompt).toMatch(/first Bash tool call MUST be `cd` alone/);
  });

  it("does not also carry the no-cd convention", () => {
    expect(prompt).not.toContain("NEVER use `cd` in Bash commands");
  });

  it("tells the agent to explore with Grep/Glob/Read", () => {
    expect(prompt).toContain("### Searching the Repository");
  });

  it("renders the search fragment after the cd rule, not before it", () => {
    expect(prompt.indexOf("### Working Directory")).toBeLessThan(
      prompt.indexOf("### Searching the Repository"),
    );
  });

  it("keeps its answer short, since a triage re-embeds it verbatim", () => {
    expect(prompt).toMatch(/re-?embed|verbatim|downstream/i);
  });
});

describe("buildPrCommentValidatorPrompt", () => {
  const prompt = buildPrCommentValidatorPrompt(input);

  it("names the thread, the file and the line under discussion", () => {
    expect(prompt).toContain("PRRT_kwDOabc");
    expect(prompt).toContain("src/cache.ts");
    expect(prompt).toContain("88");
  });

  it("quotes the comment body and its author", () => {
    expect(prompt).toContain("This early return skips the unlock.");
    expect(prompt).toContain("reviewer");
  });

  it("gives the worktree as a bare cd, per the working-directory rule", () => {
    expect(prompt).toContain(`cd ${input.worktreePath}`);
  });

  it("gives the diff range so the agent can see what this PR changed", () => {
    expect(prompt).toContain("origin/main...HEAD");
  });

  it("marks an outdated thread, which changes what the comment refers to", () => {
    const outdated = buildPrCommentValidatorPrompt({
      ...input,
      thread: { ...input.thread, isOutdated: true },
    });
    expect(outdated).toMatch(/outdated/i);
    expect(prompt).not.toMatch(/marked \*\*outdated\*\*/i);
  });

  it("renders every comment in a thread, in order", () => {
    const multi = buildPrCommentValidatorPrompt({
      ...input,
      thread: {
        ...input.thread,
        comments: [
          ...input.thread.comments,
          {
            url: "https://github.com/acme/widgets/pull/42#discussion_r2",
            author: "author",
            body: "The unlock is in the caller.",
            createdAt: "2026-08-04T11:00:00Z",
          },
        ],
      },
    });
    expect(multi.indexOf("This early return skips the unlock.")).toBeLessThan(
      multi.indexOf("The unlock is in the caller."),
    );
  });

  it("survives a thread anchored to no file", () => {
    const unanchored = buildPrCommentValidatorPrompt({
      ...input,
      thread: { ...input.thread, path: null, line: null },
    });
    expect(unanchored).toContain("PRRT_kwDOabc");
    expect(unanchored).not.toContain("null");
  });
});

describe("PR_COMMENT_VALIDATION_SCHEMA", () => {
  it("requires every field the validation store persists", () => {
    const props = PR_COMMENT_VALIDATION_SCHEMA.properties as Record<string, unknown>;
    for (const field of ["verdict", "interpretation", "reasoning", "recommendation", "evidence"]) {
      expect(props).toHaveProperty(field);
    }
    expect(PR_COMMENT_VALIDATION_SCHEMA.required).toEqual(
      expect.arrayContaining(["verdict", "interpretation", "reasoning", "recommendation"]),
    );
  });

  it("constrains the verdict to the three the store knows", () => {
    const verdict = (PR_COMMENT_VALIDATION_SCHEMA.properties as { verdict: { enum: string[] } }).verdict;
    expect(verdict.enum).toEqual(["valid", "invalid", "unclear"]);
  });
});
