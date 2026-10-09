import { describe, expect, it } from "vitest";
import {
  parseTodoFile,
  parseTodoItems,
  parseTodoSections,
  groupTodoItemsWithParents,
  batchTodoGroups,
  renderTodoGroupsAsMarkdown,
  stripCompletedTodoItems,
  normalizeTodoCheckboxes,
  extractPrReviewThreadsSection,
} from "@/lib/parsers/todo";

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

  it("returns 100 progress for empty content (no items = complete)", () => {
    const file = parseTodoFile("TODO-empty.md", "");
    expect(file.total).toBe(0);
    expect(file.progress).toBe(100);
  });

  it("extracts repo name from various filename formats", () => {
    expect(parseTodoFile("TODO-api-server.md", "").repoName).toBe("api-server");
    expect(parseTodoFile("TODO-frontend.md", "").repoName).toBe("frontend");
    expect(parseTodoFile("notes.md", "").repoName).toBe("notes");
  });
});

describe("groupTodoItemsWithParents", () => {
  it("groups indent=0 as parents with indent>0 as sub-items", () => {
    const items = parseTodoItems(`- [ ] Parent 1
  - [ ] Sub 1a
  - [ ] Sub 1b
- [ ] Parent 2
  - [ ] Sub 2a`);
    const groups = groupTodoItemsWithParents(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].parent.text).toBe("Parent 1");
    expect(groups[0].subItems).toHaveLength(2);
    expect(groups[0].subItems[0].text).toBe("Sub 1a");
    expect(groups[0].subItems[1].text).toBe("Sub 1b");
    expect(groups[1].parent.text).toBe("Parent 2");
    expect(groups[1].subItems).toHaveLength(1);
  });

  it("ignores leading sub-items without a parent", () => {
    const items = parseTodoItems(`  - [ ] Orphan sub
- [ ] Parent`);
    const groups = groupTodoItemsWithParents(items);
    // The orphan sub-item (indent=2) has no parent before it, so it's skipped
    // Parent (indent=0) becomes a group
    expect(groups).toHaveLength(1);
    expect(groups[0].parent.text).toBe("Parent");
  });
});

describe("batchTodoGroups", () => {
  it("splits actionable groups into batches of given size", () => {
    const items = parseTodoItems(`- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4
- [ ] Task 5`);
    const groups = groupTodoItemsWithParents(items);
    const batches = batchTodoGroups(groups, 2);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(2);
    expect(batches[2]).toHaveLength(1);
  });

  it("filters out completed and blocked groups", () => {
    const items = parseTodoItems(`- [x] Done
- [ ] Pending
- [!] Blocked
- [~] In progress`);
    const groups = groupTodoItemsWithParents(items);
    const batches = batchTodoGroups(groups, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2); // pending + in_progress
    expect(batches[0][0].parent.text).toBe("Pending");
    expect(batches[0][1].parent.text).toBe("In progress");
  });
});

describe("renderTodoGroupsAsMarkdown", () => {
  it("renders groups back to markdown with correct markers", () => {
    const items = parseTodoItems(`- [ ] Pending task
- [x] Completed task
- [!] Blocked task
- [~] In progress task`);
    const groups = groupTodoItemsWithParents(items);
    const md = renderTodoGroupsAsMarkdown(groups);
    expect(md).toContain("- [ ] Pending task");
    expect(md).toContain("- [x] Completed task");
    expect(md).toContain("- [!] Blocked task");
    expect(md).toContain("- [~] In progress task");
  });

  it("renders sub-items with correct indentation", () => {
    const items = parseTodoItems(`- [ ] Parent
  - [ ] Sub item`);
    const groups = groupTodoItemsWithParents(items);
    const md = renderTodoGroupsAsMarkdown(groups);
    expect(md).toBe("- [ ] Parent\n  - [ ] Sub item");
  });

  it("renders children (non-checkbox text) under items", () => {
    const items = parseTodoItems(`- [ ] Task with detail
  Some detail text
  More detail`);
    const groups = groupTodoItemsWithParents(items);
    const md = renderTodoGroupsAsMarkdown(groups);
    expect(md).toContain("- [ ] Task with detail");
    expect(md).toContain("  Some detail text");
    expect(md).toContain("  More detail");
  });
});

describe("stripCompletedTodoItems", () => {
  it("removes top-level completed items", () => {
    const content = `- [x] Done task
- [ ] Pending task
- [~] In progress task`;
    const result = stripCompletedTodoItems(content);
    expect(result).not.toContain("Done task");
    expect(result).toContain("- [ ] Pending task");
    expect(result).toContain("- [~] In progress task");
  });

  it("removes indented child lines of a completed item", () => {
    const content = `- [x] Done task
  - Target: path/to/file
  - Action: Did something
  - Verify: ran tests
- [ ] Pending task
  - Target: other/file`;
    const result = stripCompletedTodoItems(content);
    expect(result).not.toContain("Done task");
    expect(result).not.toContain("Target: path/to/file");
    expect(result).not.toContain("Action: Did something");
    expect(result).not.toContain("Verify: ran tests");
    expect(result).toContain("- [ ] Pending task");
    expect(result).toContain("Target: other/file");
  });

  it("removes completed sub-items nested under a pending parent", () => {
    const content = `- [ ] Parent task
  - [x] Done sub-item
  - [ ] Pending sub-item`;
    const result = stripCompletedTodoItems(content);
    expect(result).toContain("- [ ] Parent task");
    expect(result).not.toContain("Done sub-item");
    expect(result).toContain("- [ ] Pending sub-item");
  });

  it("preserves section headings and non-item content", () => {
    const content = `# TODO: Repo
## Phase 1
- [x] Done task
  - Target: file.ts
- [ ] Pending task

## Phase 2
- [ ] Another task`;
    const result = stripCompletedTodoItems(content);
    expect(result).toContain("# TODO: Repo");
    expect(result).toContain("## Phase 1");
    expect(result).toContain("## Phase 2");
    expect(result).toContain("- [ ] Pending task");
    expect(result).toContain("- [ ] Another task");
    expect(result).not.toContain("Done task");
    expect(result).not.toContain("Target: file.ts");
  });

  it("returns unchanged content when there are no completed items", () => {
    const content = `- [ ] Pending
- [~] In progress
- [!] Blocked`;
    expect(stripCompletedTodoItems(content)).toBe(content);
  });
});

describe("normalizeTodoCheckboxes", () => {
  it("adds checkbox to plain bullet items", () => {
    const content = "- Fix the bug\n- Add the feature";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "- [ ] Fix the bug\n- [ ] Add the feature",
    );
  });

  it("preserves existing valid checkboxes", () => {
    const content =
      "- [x] Done\n- [ ] Pending\n- [!] Blocked\n- [~] In progress";
    expect(normalizeTodoCheckboxes(content)).toBe(content);
  });

  it("does not add checkbox to child description lines", () => {
    const content =
      "- [ ] **[Target]** Fix the thing\n  - Target: path/to/file\n  - Action: Change X";
    expect(normalizeTodoCheckboxes(content)).toBe(content);
  });

  it("does not add checkbox to children under a normalized parent", () => {
    const content = "- Fix the bug\n  - Target: file.ts\n  - Action: fix it";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "- [ ] Fix the bug\n  - Target: file.ts\n  - Action: fix it",
    );
  });

  it("fixes extra spaces in brackets", () => {
    expect(normalizeTodoCheckboxes("- [  ] Fix something")).toBe(
      "- [ ] Fix something",
    );
  });

  it("fixes empty brackets", () => {
    expect(normalizeTodoCheckboxes("- [] Fix something")).toBe(
      "- [ ] Fix something",
    );
  });

  it("converts asterisk bullets", () => {
    expect(normalizeTodoCheckboxes("* [ ] Fix something")).toBe(
      "- [ ] Fix something",
    );
  });

  it("converts uppercase X marker", () => {
    expect(normalizeTodoCheckboxes("- [X] Done task")).toBe(
      "- [x] Done task",
    );
  });

  it("preserves headings and non-bullet lines", () => {
    const content = "# TODO: repo\n\n## Section\n\n- Fix the thing";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "# TODO: repo\n\n## Section\n\n- [ ] Fix the thing",
    );
  });

  it("resets tracking after blank lines for new sections", () => {
    const content =
      "- [ ] Parent\n  - Child note\n\n- New top-level item";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "- [ ] Parent\n  - Child note\n\n- [ ] New top-level item",
    );
  });

  it("handles sibling sub-items at same indent", () => {
    const content =
      "- [ ] Parent\n  - [ ] Sub with checkbox\n  - Sub without checkbox";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "- [ ] Parent\n  - [ ] Sub with checkbox\n  - [ ] Sub without checkbox",
    );
  });

  it("does not add checkboxes to items in Notes section", () => {
    const content =
      "## Phase 1\n\n- [ ] Task A\n\n## Notes\n\n- Some finding\n- Another note";
    expect(normalizeTodoCheckboxes(content)).toBe(content);
  });

  it("resumes adding checkboxes after Notes section ends", () => {
    const content =
      "## Notes\n\n- Just a note\n\n## Phase 2\n\n- Task B";
    expect(normalizeTodoCheckboxes(content)).toBe(
      "## Notes\n\n- Just a note\n\n## Phase 2\n\n- [ ] Task B",
    );
  });

  it("handles case-insensitive Notes heading", () => {
    const content = "## notes\n\n- A note\n- Another note";
    expect(normalizeTodoCheckboxes(content)).toBe(content);
  });
});

describe("extractPrReviewThreadsSection", () => {
  const content = `# TODO: my-repo

## Fixes

- [x] **[api/handler.go]** Add nil check
- [ ] **[api/router.go]** Rename param

## PR Review Threads

<!-- do not delete -->

| Thread ID | Comment URL | Summary | TODO item |
|---|---|---|---|
| PRRT_abc | https://example.com/pull/1#discussion_r1 | Nil check missing | **[api/handler.go]** Add nil check |

## Notes

- Something else`;

  it("returns the section body without the heading", () => {
    const section = extractPrReviewThreadsSection(content);
    expect(section).toContain("PRRT_abc");
    expect(section).not.toContain("## PR Review Threads");
  });

  it("stops at the next section heading", () => {
    const section = extractPrReviewThreadsSection(content);
    expect(section).not.toContain("Something else");
    expect(section).not.toContain("## Notes");
  });

  it("returns null when the section is absent", () => {
    expect(extractPrReviewThreadsSection("# TODO\n\n- [ ] Do a thing")).toBeNull();
  });

  it("returns null when the section exists but is empty", () => {
    expect(
      extractPrReviewThreadsSection("## PR Review Threads\n\n\n## Notes\n\n- x"),
    ).toBeNull();
  });

  it("matches the heading case-insensitively", () => {
    expect(
      extractPrReviewThreadsSection("## pr review threads\n\n| PRRT_x | u | s | t |"),
    ).toContain("PRRT_x");
  });

  // The table rows are the run's only durable record of which thread maps to
  // which item: `stripCompletedTodoItems` runs at the start of every cycle's
  // Update TODO, and a completed item is exactly the one we need to reply about.
  it("survives stripCompletedTodoItems", () => {
    const stripped = stripCompletedTodoItems(content);
    expect(extractPrReviewThreadsSection(stripped)).toContain("PRRT_abc");
  });

  // Table rows do not start with `- `, so the normalizer must leave them alone
  // rather than turning them into checkbox items.
  it("survives normalizeTodoCheckboxes", () => {
    const normalized = normalizeTodoCheckboxes(content);
    expect(extractPrReviewThreadsSection(normalized)).toContain("PRRT_abc");
    expect(normalized).not.toContain("- [ ] | PRRT_abc");
  });
});
