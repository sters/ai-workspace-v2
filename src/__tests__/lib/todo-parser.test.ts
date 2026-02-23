import { describe, expect, it } from "vitest";
import { parseTodoFile, parseTodoItems, parseTodoSections } from "@/lib/todo-parser";

describe("parseTodoItems", () => {
  it("parses completed items", () => {
    const items = parseTodoItems("- [x] Implement login");
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      text: "Implement login",
      status: "completed",
      indent: 0,
      children: [],
    });
  });

  it("parses pending items", () => {
    const items = parseTodoItems("- [ ] Write tests");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("pending");
    expect(items[0].text).toBe("Write tests");
  });

  it("parses blocked items", () => {
    const items = parseTodoItems("- [!] Waiting for API");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("blocked");
    expect(items[0].text).toBe("Waiting for API");
  });

  it("parses in-progress items", () => {
    const items = parseTodoItems("- [~] Working on refactor");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("in_progress");
    expect(items[0].text).toBe("Working on refactor");
  });

  it("parses multiple items with different statuses", () => {
    const content = `- [x] Done task
- [ ] Pending task
- [!] Blocked task
- [~] In progress task`;
    const items = parseTodoItems(content);
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.status)).toEqual([
      "completed",
      "pending",
      "blocked",
      "in_progress",
    ]);
  });

  it("captures indent level", () => {
    const content = `- [x] Top level
  - [ ] Indented two spaces
    - [~] Indented four spaces`;
    const items = parseTodoItems(content);
    expect(items).toHaveLength(3);
    expect(items[0].indent).toBe(0);
    expect(items[1].indent).toBe(2);
    expect(items[2].indent).toBe(4);
  });

  it("attaches indented non-checkbox lines as children", () => {
    const content = `- [x] Main task
  Additional detail line
  Another detail`;
    const items = parseTodoItems(content);
    expect(items).toHaveLength(1);
    expect(items[0].children).toEqual([
      "Additional detail line",
      "Another detail",
    ]);
  });

  it("ignores blank indented lines in children", () => {
    const content = `- [x] Main task
  Detail

  More detail`;
    const items = parseTodoItems(content);
    expect(items[0].children).toEqual(["Detail", "More detail"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseTodoItems("")).toEqual([]);
  });

  it("returns empty array for non-todo content", () => {
    expect(parseTodoItems("# Just a heading\nSome text")).toEqual([]);
  });

  it("trims whitespace from item text", () => {
    const items = parseTodoItems("- [x]   Extra spaces around text  ");
    expect(items[0].text).toBe("Extra spaces around text");
  });
});

describe("parseTodoSections", () => {
  it("parses sections with headings", () => {
    const content = `# TODO: My Project
## Phase 1
- [x] Task A
- [ ] Task B

## Phase 2
- [~] Task C`;
    const sections = parseTodoSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("Phase 1");
    expect(sections[0].items).toHaveLength(2);
    expect(sections[1].heading).toBe("Phase 2");
    expect(sections[1].items).toHaveLength(1);
  });

  it("skips top-level heading (# ...)", () => {
    const content = `# TODO: Project Name
- [x] Task without section`;
    const sections = parseTodoSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("");
    expect(sections[0].items).toHaveLength(1);
  });

  it("creates implicit section for items before first heading", () => {
    const content = `- [x] Orphan task
## Section
- [ ] Other task`;
    const sections = parseTodoSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe("");
    expect(sections[0].items[0].text).toBe("Orphan task");
    expect(sections[1].heading).toBe("Section");
  });

  it("collects non-checkbox, non-indented text as notes", () => {
    const content = `## Section
Some explanatory note
- [ ] A task
Another note`;
    const sections = parseTodoSections(content);
    expect(sections[0].notes).toContain("Some explanatory note");
    expect(sections[0].notes).toContain("Another note");
  });

  it("attaches indented lines as children of the last item", () => {
    const content = `## Section
- [x] Main task
  Child detail`;
    const sections = parseTodoSections(content);
    expect(sections[0].items[0].children).toEqual(["Child detail"]);
  });

  it("resets lastItem on non-indented note lines", () => {
    const content = `## Section
- [x] Task A
A note line
  This is a note, not a child of Task A`;
    const sections = parseTodoSections(content);
    // "A note line" becomes a note and resets lastItem
    expect(sections[0].notes).toContain("A note line");
    // "This is a note, not a child" - since lastItem was reset, this goes to notes too
    expect(sections[0].notes).toContain("This is a note, not a child of Task A");
  });

  it("does not emit empty sections", () => {
    const content = `## Empty Section

## Filled Section
- [x] Task`;
    const sections = parseTodoSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Filled Section");
  });

  it("returns empty array for empty input", () => {
    expect(parseTodoSections("")).toEqual([]);
  });
});

describe("parseTodoFile", () => {
  it("returns aggregated stats and extracts repo name", () => {
    const content = `- [x] Done
- [ ] Pending
- [!] Blocked
- [~] In progress`;
    const file = parseTodoFile("TODO-my-repo.md", content);
    expect(file.filename).toBe("TODO-my-repo.md");
    expect(file.repoName).toBe("my-repo");
    expect(file.total).toBe(4);
    expect(file.completed).toBe(1);
    expect(file.pending).toBe(1);
    expect(file.blocked).toBe(1);
    expect(file.inProgress).toBe(1);
    expect(file.progress).toBe(25); // 1/4 = 25%
  });

  it("calculates progress correctly", () => {
    const content = `- [x] Done 1
- [x] Done 2
- [ ] Not done`;
    const file = parseTodoFile("TODO-test.md", content);
    expect(file.progress).toBe(67); // Math.round(2/3 * 100)
  });

  it("handles 100% progress", () => {
    const content = `- [x] All
- [x] Done`;
    const file = parseTodoFile("TODO-test.md", content);
    expect(file.progress).toBe(100);
  });

  it("handles 0% progress", () => {
    const content = `- [ ] Nothing done`;
    const file = parseTodoFile("TODO-test.md", content);
    expect(file.progress).toBe(0);
  });

  it("returns 0 progress for empty content", () => {
    const file = parseTodoFile("TODO-empty.md", "");
    expect(file.total).toBe(0);
    expect(file.progress).toBe(0);
  });

  it("extracts repo name from various filename formats", () => {
    expect(parseTodoFile("TODO-api-server.md", "").repoName).toBe("api-server");
    expect(parseTodoFile("TODO-frontend.md", "").repoName).toBe("frontend");
    expect(parseTodoFile("notes.md", "").repoName).toBe("notes");
  });

  it("includes both items and sections", () => {
    const content = `## Section A
- [x] Task 1
## Section B
- [ ] Task 2`;
    const file = parseTodoFile("TODO-test.md", content);
    expect(file.items).toHaveLength(2);
    expect(file.sections).toHaveLength(2);
  });
});
