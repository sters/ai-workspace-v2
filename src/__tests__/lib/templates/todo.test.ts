import { describe, expect, it } from "vitest";
import {
  TODO_FEATURE_TEMPLATE,
  TODO_BUGFIX_TEMPLATE,
  TODO_RESEARCH_TEMPLATE,
  selectTodoTemplate,
} from "@/lib/templates/todo";

describe("TODO_FEATURE_TEMPLATE", () => {
  it("includes the strict item fields (Target, Action, Pattern, Verify, Why, Acceptance)", () => {
    expect(TODO_FEATURE_TEMPLATE).toContain("Target:");
    expect(TODO_FEATURE_TEMPLATE).toContain("Action:");
    expect(TODO_FEATURE_TEMPLATE).toContain("Pattern:");
    expect(TODO_FEATURE_TEMPLATE).toContain("Verify:");
    expect(TODO_FEATURE_TEMPLATE).toContain("Why:");
    expect(TODO_FEATURE_TEMPLATE).toContain("Acceptance:");
  });

  it("hints that Target should include path:line or symbol", () => {
    expect(TODO_FEATURE_TEMPLATE).toMatch(/path:line|symbol|function name/i);
  });
});

describe("TODO_BUGFIX_TEMPLATE", () => {
  it("includes the strict item fields", () => {
    expect(TODO_BUGFIX_TEMPLATE).toContain("Target:");
    expect(TODO_BUGFIX_TEMPLATE).toContain("Action:");
    expect(TODO_BUGFIX_TEMPLATE).toContain("Pattern:");
    expect(TODO_BUGFIX_TEMPLATE).toContain("Verify:");
    expect(TODO_BUGFIX_TEMPLATE).toContain("Why:");
    expect(TODO_BUGFIX_TEMPLATE).toContain("Acceptance:");
  });
});

describe("TODO_RESEARCH_TEMPLATE", () => {
  it("stays lenient — does not force Pattern/Verify/Acceptance", () => {
    expect(TODO_RESEARCH_TEMPLATE).not.toMatch(/Pattern:/);
    expect(TODO_RESEARCH_TEMPLATE).not.toMatch(/Acceptance:/);
  });
});

describe("selectTodoTemplate", () => {
  it("returns the feature template for 'feature' and 'implementation'", () => {
    expect(selectTodoTemplate("feature")).toBe(TODO_FEATURE_TEMPLATE);
    expect(selectTodoTemplate("implementation")).toBe(TODO_FEATURE_TEMPLATE);
  });

  it("returns the bugfix template for 'bugfix' and 'bug'", () => {
    expect(selectTodoTemplate("bugfix")).toBe(TODO_BUGFIX_TEMPLATE);
    expect(selectTodoTemplate("bug")).toBe(TODO_BUGFIX_TEMPLATE);
  });

  it("returns the research template for 'research'", () => {
    expect(selectTodoTemplate("research")).toBe(TODO_RESEARCH_TEMPLATE);
  });
});
