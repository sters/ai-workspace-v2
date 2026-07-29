import { describe, expect, it } from "vitest";
import {
  TODO_FEATURE_TEMPLATE,
  TODO_BUGFIX_TEMPLATE,
  TODO_RESEARCH_TEMPLATE,
  selectTodoTemplate,
} from "@/lib/templates/todo";

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
