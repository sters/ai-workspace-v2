import {
  TODO_REVIEW_SCHEMA,
  buildReviewerPrompt,
  buildTodoReviewResolutionInstruction,
  getReviewerSystemPrompt,
} from "@/lib/templates/prompts/reviewer";
import { REPO_SEARCH_EFFICIENCY } from "@/lib/templates/prompts/shared";
import type { ReviewerInput, TodoReviewFinding } from "@/types/prompts";

describe("TODO_REVIEW_SCHEMA", () => {
  it("requires a status and a findings list", () => {
    expect(TODO_REVIEW_SCHEMA.required).toEqual(expect.arrayContaining(["status", "findings"]));
  });

  it("anchors every finding to an item with an actionable detail", () => {
    expect(TODO_REVIEW_SCHEMA.properties.findings.items.required).toEqual(
      expect.arrayContaining(["kind", "item", "detail"]),
    );
  });

  it("carries a risk kind alongside the two question kinds", () => {
    expect(TODO_REVIEW_SCHEMA.properties.findings.items.properties.kind.enum).toEqual(
      expect.arrayContaining(["blocking", "unclear", "risk"]),
    );
  });
});

describe("getReviewerSystemPrompt", () => {
  const prompt = getReviewerSystemPrompt();

  it("states that the verdict is applied, so findings must be actionable", () => {
    expect(prompt).toMatch(/revision step/i);
    expect(prompt).toMatch(/rewrites the TODO file/i);
  });

  // A predicted regression phrased as a question reads as human-input-required
  // and gets parked; phrased as a defect it becomes a plan amendment.
  it("asks for risk findings as a defect statement rather than a question", () => {
    expect(prompt).toMatch(/\*\*risk\*\*/);
    expect(prompt).toMatch(/not as a question|rather than as a question/i);
  });

  it("checks item targets against the README's Non-Goal section", () => {
    expect(prompt).toMatch(/## Non-Goal/);
    expect(prompt).toMatch(/even when the edit itself looks harmless/i);
  });

  it("flags an item whose only verification is a human looking at it", () => {
    expect(prompt).toMatch(/Verify/);
    expect(prompt).toMatch(/human handoff/i);
    expect(prompt).toMatch(/confirm in dev|by eye|looking at/i);
  });

  it("flags prescribed code that changes a contract today's callers rely on", () => {
    expect(prompt).toMatch(/nullability|contract/i);
  });

  // Two writers to one TODO file is the defect the revision step exists to avoid.
  it("is read-only — the revision step owns the TODO file", () => {
    expect(prompt).toMatch(/read-only/i);
    expect(prompt).not.toMatch(/NEEDS_CLARIFICATION/);
  });

  it("returns JSON matching the schema", () => {
    expect(prompt).toMatch(/JSON object matching the schema/i);
  });

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

  it("names both exits: amend the item, or record it as a blocked item", () => {
    const instruction = buildTodoReviewResolutionInstruction({ findings });
    expect(instruction).toMatch(/- \[!\]/);
    expect(instruction).toMatch(/Action|Verify/);
  });

  // The whole point of the step: nothing may vanish the way the old verdict did.
  it("forbids dropping a finding without an exit", () => {
    const instruction = buildTodoReviewResolutionInstruction({ findings });
    expect(instruction).toMatch(/every finding/i);
  });

  it("keeps risk findings out of the blocked-item exit", () => {
    const instruction = buildTodoReviewResolutionInstruction({ findings });
    expect(instruction).toMatch(/risk.*(never|not).*(blocked|\[!\])|(blocked|\[!\]).*not.*risk/is);
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

describe("buildReviewerPrompt", () => {
  const input: ReviewerInput = {
    workspaceName: "ws",
    repoName: "frontend",
    readmeContent: "# Task\n\n## Non-Goal\n\n- Other screens",
    todoContent: "- [ ] **[View]** Add the rows",
    worktreePath: "/tmp/frontend",
  };

  it("passes the README and TODO through so both sides can be compared", () => {
    const prompt = buildReviewerPrompt(input);
    expect(prompt).toContain("## Non-Goal");
    expect(prompt).toContain("Add the rows");
    expect(prompt).toContain("/tmp/frontend");
  });
});
