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

describe("TODO templates — item count discipline", () => {
  const codeTemplates = [
    ["feature", TODO_FEATURE_TEMPLATE],
    ["bugfix", TODO_BUGFIX_TEMPLATE],
  ] as const;

  it.each(codeTemplates)("%s: has exactly one verification item", (_name, template) => {
    const section = template.split("## Verification")[1]?.split("\n## ")[0] ?? "";
    expect(section.match(/^- \[ \]/gm) ?? []).toHaveLength(1);
  });

  it.each(codeTemplates)("%s: drops the Acceptance field", (_name, template) => {
    // Verify doubles as the acceptance condition; a sixth mandatory field padded
    // the file and cost the planner a search per item.
    expect(template).not.toContain("Acceptance:");
  });

  it.each(codeTemplates)("%s: marks Pattern and Why as conditional", (_name, template) => {
    expect(template).toMatch(/- Pattern: \(only where/);
  });

  it.each([
    TODO_FEATURE_TEMPLATE,
    TODO_BUGFIX_TEMPLATE,
    TODO_RESEARCH_TEMPLATE,
  ])("marks the Initialize doc list as prose rather than a checklist", (template) => {
    const section = template.split("## Initialize")[1]?.split("\n## ")[0] ?? "";
    expect(section).toContain("NOT a checklist");
    expect(section.match(/^- \[ \]/gm)).toBeNull();
  });
});
