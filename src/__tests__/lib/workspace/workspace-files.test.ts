import { describe, it, expect } from "vitest";
import { appendTodoItems, replaceReadmeSections } from "@/lib/workspace/workspace-files";
import { parseAcceptanceCriteria, parseReadmeMeta } from "@/lib/parsers/readme";
import { parseTodoItems, parseTodoSections } from "@/lib/parsers/todo";
import { buildReadmeContent } from "@/lib/templates";

const README = buildReadmeContent("Return 404 for unknown users", "feature", "PROJ-1", "2026-11-18")
  .replace("<!-- Fill in before running setup-repository.sh -->", "- **api**: `github.com/acme/api` (base: `main`)")
  .replace("- [ ] (auto)\n", "- [x] (auto) `make test` passes\n- [ ] (manual) Looks right on staging\n");

function section(content: string, heading: string): string {
  const start = content.indexOf(`## ${heading}\n`);
  const rest = content.slice(start + heading.length + 4);
  const end = rest.search(/^#{1,2} /m);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

describe("replaceReadmeSections", () => {
  it("replaces only the sections given and leaves the rest of the README as it was", () => {
    const out = replaceReadmeSections(README, { goal: "Unknown ids get a 404.", requirements: "- Use `ErrNotFound`" });

    expect(section(out, "Goal")).toBe("Unknown ids get a 404.");
    expect(section(out, "Requirements")).toBe("- Use `ErrNotFound`");
    for (const kept of ["Initial Request", "Non-Goal", "Context", "Repository Constraints", "Related Resources"]) {
      expect(section(out, kept)).toBe(section(README, kept));
    }
    expect(parseReadmeMeta(out).repositories).toEqual(parseReadmeMeta(README).repositories);
  });

  it("renders acceptance criteria the verifier reads, keeping a criterion's check when its text is unchanged", () => {
    const out = replaceReadmeSections(README, {
      acceptanceCriteria: [
        { kind: "auto", text: "`make test` passes" },
        { kind: "auto", text: "`GET /users/42` returns 404" },
        { kind: "manual", text: "Product signs off" },
      ],
    });

    expect(parseAcceptanceCriteria(out)).toEqual([
      { kind: "auto", text: "`make test` passes", checked: true },
      { kind: "auto", text: "`GET /users/42` returns 404", checked: false },
      { kind: "manual", text: "Product signs off", checked: false },
    ]);
  });

  it("sets a criterion's check when checked is given, overriding the one it had", () => {
    const out = replaceReadmeSections(README, {
      acceptanceCriteria: [
        { kind: "auto", text: "`make test` passes", checked: false },
        { kind: "manual", text: "Looks right on staging", checked: true },
      ],
    });

    expect(parseAcceptanceCriteria(out).map((c) => c.checked)).toEqual([false, true]);
  });

  it("retitles the task and adds a section the README lacks", () => {
    const withoutContext = README.replace(/## Context\n[\s\S]*?(?=## Requirements)/, "");
    const out = replaceReadmeSections(withoutContext, { title: "Return 404 for unknown users", context: "Clients retry on 5xx." });

    expect(parseReadmeMeta(out).title).toBe("Return 404 for unknown users");
    expect(section(out, "Context")).toBe("Clients retry on 5xx.");
  });
});

const ITEM = {
  tag: "API",
  title: "Return 404 for an unknown user id",
  target: "`internal/users/handler.go → GetUser`",
  action: "Write `http.StatusNotFound` when `repo.Find` returns `ErrNotFound`",
  verify: "`go test ./internal/users -run TestGetUserNotFound` passes",
};

describe("appendTodoItems", () => {
  it("starts a missing file from the task type's template without its placeholder items", () => {
    const out = appendTodoItems(null, { repoName: "api", taskType: "feature", section: "Implementation Tasks", items: [ITEM] });

    expect(out).toMatch(/^# TODO: api\n/);
    expect(out).not.toContain("[TBD]");
    const implementation = parseTodoSections(out).find((s) => s.heading === "Implementation Tasks");
    expect(implementation?.items).toEqual([
      {
        text: "**[API]** Return 404 for an unknown user id",
        status: "pending",
        indent: 0,
        children: [`- Target: ${ITEM.target}`, `- Action: ${ITEM.action}`, `- Verify: ${ITEM.verify}`],
      },
    ]);
  });

  it("appends after a section's existing items, leaving the other sections in place", () => {
    const existing = [
      "# TODO: api",
      "",
      "## Tasks",
      "",
      "- [x] **[Docs]** Document the endpoint",
      "  - Target: docs/api.md",
      "",
      "## Notes",
      "",
      "Blocked on review.",
      "",
    ].join("\n");

    const out = appendTodoItems(existing, {
      repoName: "api",
      taskType: "feature",
      section: "Tasks",
      items: [{ ...ITEM, why: "Clients retry on 5xx" }],
    });

    const sections = parseTodoSections(out);
    expect(sections.map((s) => s.heading)).toEqual(["Tasks", "Notes"]);
    expect(sections[0].items.map((i) => i.status)).toEqual(["completed", "pending"]);
    expect(sections[0].items[1].children).toContain("- Why: Clients retry on 5xx");
    expect(out).toContain("## Notes\n\nBlocked on review.");
  });

  it("creates a missing section ahead of the file's trailing sections", () => {
    const existing = appendTodoItems(null, { repoName: "api", taskType: "feature", section: "Implementation Tasks", items: [ITEM] });

    const out = appendTodoItems(existing, {
      repoName: "api",
      taskType: "feature",
      section: "Follow-up",
      items: [{ ...ITEM, title: "Log the miss" }],
    });

    const titles = parseTodoSections(out).map((s) => s.heading);
    expect(titles.indexOf("Follow-up")).toBe(titles.indexOf("Implementation Tasks") + 1);
    expect(parseTodoItems(out).filter((i) => i.text.includes("Log the miss"))).toHaveLength(1);
  });
});
