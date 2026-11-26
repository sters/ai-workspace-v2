/**
 * Structured writes to a workspace's README.md and TODO-<repo>.md, for callers
 * that are not pipeline agents (the MCP tools a chat uses). The output is in
 * the shape `parsers/readme.ts` and `parsers/todo.ts` read, so the WebUI and
 * every operation see these edits exactly as they see an operation's own.
 */

import { parseAcceptanceCriteria } from "@/lib/parsers/readme";
import { selectTodoTemplate } from "@/lib/templates";

interface Section {
  heading: string;
  body: string;
}

/** Text before the first `## ` heading, then each `## ` section with its body. */
function splitSections(content: string): { preamble: string; sections: Section[] } {
  const parts = content.split(/^(?=## )/m);
  const preamble = parts[0].startsWith("## ") ? "" : (parts.shift() ?? "");
  const sections = parts.map((part) => {
    const newline = part.indexOf("\n");
    return newline === -1
      ? { heading: part.slice(3).trim(), body: "" }
      : { heading: part.slice(3, newline).trim(), body: part.slice(newline + 1) };
  });
  return { preamble, sections };
}

function joinSections(preamble: string, sections: Section[]): string {
  const text = preamble + sections.map((s) => `## ${s.heading}\n${s.body}`).join("");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function sectionBody(text: string): string {
  return `\n${text.trim()}\n\n`;
}

/** Puts a new section before the first of `before` the file has, else at the end. */
function insertSection(sections: Section[], section: Section, before: string[]): void {
  const at = sections.findIndex((s) => before.includes(s.heading));
  if (at === -1) {
    const last = sections.at(-1);
    if (last && !last.body.endsWith("\n\n")) last.body = `${last.body.trimEnd()}\n\n`;
    sections.push(section);
  } else {
    sections.splice(at, 0, section);
  }
}

export interface AcceptanceCriterionInput {
  kind: "auto" | "manual";
  text: string;
  checked?: boolean;
}

export interface ReadmeSectionsInput {
  title?: string;
  goal?: string;
  nonGoal?: string;
  assumptions?: string;
  context?: string;
  requirements?: string;
  acceptanceCriteria?: AcceptanceCriterionInput[];
  relatedResources?: string;
}

const README_HEADINGS: Record<Exclude<keyof ReadmeSectionsInput, "title" | "acceptanceCriteria">, string> = {
  goal: "Goal",
  nonGoal: "Non-Goal",
  assumptions: "Assumptions",
  context: "Context",
  requirements: "Requirements",
  relatedResources: "Related Resources",
};

function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Replaces each given section's body whole. A criterion without `checked`
 * keeps the checked state of the one with the same text already in the
 * README, so restating the list does not undo what the verifier has confirmed.
 */
export function replaceReadmeSections(content: string, input: ReadmeSectionsInput): string {
  const { preamble, sections } = splitSections(content);
  const bodies = new Map<string, string>();
  for (const [key, heading] of Object.entries(README_HEADINGS)) {
    const text = input[key as keyof typeof README_HEADINGS];
    if (text !== undefined) bodies.set(heading, sectionBody(text));
  }
  if (input.acceptanceCriteria) {
    const checked = new Set(parseAcceptanceCriteria(content).filter((c) => c.checked).map((c) => c.text));
    const lines = input.acceptanceCriteria.map((c) => {
      const text = singleLine(c.text);
      return `- [${(c.checked ?? checked.has(text)) ? "x" : " "}] (${c.kind}) ${text}`;
    });
    bodies.set("Acceptance Criteria", sectionBody(lines.join("\n")));
  }

  for (const [heading, body] of bodies) {
    const existing = sections.find((s) => s.heading === heading);
    if (existing) existing.body = body;
    else insertSection(sections, { heading, body }, ["Repository Constraints", "Related Resources"]);
  }

  const head = input.title
    ? preamble.replace(/^# Task:.*$/m, `# Task: ${singleLine(input.title)}`)
    : preamble;
  return joinSections(head, sections);
}

export interface TodoItemInput {
  tag: string;
  title: string;
  target: string;
  action: string;
  verify?: string;
  pattern?: string;
  why?: string;
}

function renderTodoItem(item: TodoItemInput): string {
  const fields: [string, string | undefined][] = [
    ["Target", item.target],
    ["Action", item.action],
    ["Verify", item.verify],
    ["Pattern", item.pattern],
    ["Why", item.why],
  ];
  return [
    `- [ ] **[${singleLine(item.tag)}]** ${singleLine(item.title)}`,
    ...fields.filter(([, value]) => value?.trim()).map(([label, value]) => `  - ${label}: ${singleLine(value!)}`),
  ].join("\n");
}

/** The template's `- [ ] **[TBD]** …` items, each with its indented lines. */
function withoutPlaceholderItems(template: string): string {
  return template
    .replace(/^- \[ \] \*\*\[TBD\]\*\*.*\n(?:[ \t]+\S.*\n)*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Appends pending items at the end of `section`, creating the section (before
 * the file's Verification / Finalize / Notes) or the whole file (from the task
 * type's TODO template, placeholders removed) when it is missing.
 */
export function appendTodoItems(
  content: string | null,
  input: { repoName: string; taskType: string; section: string; items: TodoItemInput[] },
): string {
  const source =
    content ?? withoutPlaceholderItems(selectTodoTemplate(input.taskType).replace("{{REPOSITORY_NAME}}", input.repoName));
  const { preamble, sections } = splitSections(source);
  const items = input.items.map(renderTodoItem).join("\n");

  const existing = sections.find((s) => s.heading === input.section);
  if (existing) existing.body = `${existing.body.trimEnd()}\n\n${items}\n\n`.replace(/^\n+/, "\n");
  else insertSection(sections, { heading: input.section, body: sectionBody(items) }, ["Verification", "Finalize", "Notes"]);

  return joinSections(preamble, sections);
}
