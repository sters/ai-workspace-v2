import {
  TODO_REVIEW_SCHEMA,
  buildTodoReviewResolutionInstruction,
  getReviewerSystemPrompt,
} from "@/lib/templates/prompts/reviewer";
import { REPO_SEARCH_EFFICIENCY } from "@/lib/templates/prompts/shared";
import type { TodoReviewFinding } from "@/types/prompts";

describe("TODO_REVIEW_SCHEMA", () => {
  // The resolution instruction branches on `kind`, so the enum is a contract
  // between the reviewer's verdict and the reviser that applies it.
  it("carries a risk kind alongside the two question kinds", () => {
    expect(TODO_REVIEW_SCHEMA.properties.findings.items.properties.kind.enum).toEqual(
      expect.arrayContaining(["blocking", "unclear", "risk"]),
    );
  });
});

describe("getReviewerSystemPrompt", () => {
  const prompt = getReviewerSystemPrompt();

  it("carries the repo-search convention it needs to confirm the plan's claims", () => {
    expect(prompt).toContain(REPO_SEARCH_EFFICIENCY);
  });
});

describe("buildTodoReviewResolutionInstruction", () => {
  const findings: TodoReviewFinding[] = [
    {
      kind: "risk",
      item: "[Refactor] Point the panel at the shared URL builders",
      detail: "The shared builder returns undefined, so the panel's <a> loses its href.",
      suggestedResolution: "Give the call site the same plain-text fallback the new rows use.",
    },
    {
      kind: "unclear",
      item: "[Layout] Make the screen one scrolling page",
      detail: "The sibling panel's h-full no longer resolves once the parent stops being h-screen.",
    },
    {
      kind: "blocking",
      item: "[Setup] Initialize the schema submodule",
      detail: "Which remote should the submodule be fetched from?",
    },
  ];

  it("renders every finding with its kind", () => {
    const instruction = buildTodoReviewResolutionInstruction({ findings });
    for (const f of findings) {
      expect(instruction).toContain(f.item);
      expect(instruction).toContain(f.detail);
    }
    expect(instruction).toContain("risk");
    expect(instruction).toContain("blocking");
  });

  it("carries a suggested resolution when the reviewer had one", () => {
    const instruction = buildTodoReviewResolutionInstruction({ findings });
    expect(instruction).toContain("plain-text fallback");
  });

  it("folds human answers in when the run asked for them", () => {
    const instruction = buildTodoReviewResolutionInstruction({
      findings,
      answers: [{ detail: "Which remote?", answer: "git@github.com:acme/graphql.git" }],
    });
    expect(instruction).toContain("git@github.com:acme/graphql.git");
    expect(instruction).toMatch(/answered/i);
  });

  it("returns an empty string when there is nothing to resolve", () => {
    expect(buildTodoReviewResolutionInstruction({ findings: [] })).toBe("");
  });
});
