import type { TodoItem, TodoFile, TodoSection } from "@/types/workspace";

// ---------------------------------------------------------------------------
// Batch utilities
// ---------------------------------------------------------------------------

export interface TodoItemGroup {
  parent: TodoItem;
  subItems: TodoItem[];
}

/**
 * Group flat TodoItem[] into parent/sub-item groups.
 * indent=0 items become parents; indent>0 items attach to the preceding parent.
 */
export function groupTodoItemsWithParents(items: TodoItem[]): TodoItemGroup[] {
  const groups: TodoItemGroup[] = [];
  for (const item of items) {
    if (item.indent === 0) {
      groups.push({ parent: item, subItems: [] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].subItems.push(item);
    }
  }
  return groups;
}

/**
 * Extract pending/in_progress groups and split into batches of `batchSize`.
 * A group is considered actionable if the parent is pending or in_progress.
 */
export function batchTodoGroups(
  groups: TodoItemGroup[],
  batchSize: number,
): TodoItemGroup[][] {
  const actionable = groups.filter(
    (g) => g.parent.status === "pending" || g.parent.status === "in_progress",
  );
  if (actionable.length === 0) return [];

  const batches: TodoItemGroup[][] = [];
  for (let i = 0; i < actionable.length; i += batchSize) {
    batches.push(actionable.slice(i, i + batchSize));
  }
  return batches;
}

export function statusToMarker(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "x";
    case "pending":
      return " ";
    case "blocked":
      return "!";
    case "in_progress":
      return "~";
  }
}

/**
 * Render TodoItemGroup[] back into markdown checkbox syntax.
 */
export function renderTodoGroupsAsMarkdown(groups: TodoItemGroup[]): string {
  const lines: string[] = [];
  for (const group of groups) {
    const indent = " ".repeat(group.parent.indent);
    lines.push(
      `${indent}- [${statusToMarker(group.parent.status)}] ${group.parent.text}`,
    );
    for (const child of group.parent.children) {
      lines.push(`${indent}  ${child}`);
    }
    for (const sub of group.subItems) {
      const subIndent = " ".repeat(sub.indent);
      lines.push(`${subIndent}- [${statusToMarker(sub.status)}] ${sub.text}`);
      for (const child of sub.children) {
        lines.push(`${subIndent}  ${child}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Remove completed (`- [x]`) TODO items from raw markdown content, including
 * any indented child lines (sub-items or continuation notes) that belong to
 * them. Used to keep TODO files compact before the updater agent rewrites them.
 */
export function stripCompletedTodoItems(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipIndent = -1; // -1 means "not currently skipping"

  for (const line of lines) {
    const checkboxMatch = line.match(/^(\s*)- \[([ x!~])\]/);

    if (skipIndent >= 0) {
      if (checkboxMatch) {
        const indent = checkboxMatch[1].length;
        if (indent > skipIndent) {
          // Nested checkbox under a completed parent — skip
          continue;
        }
        // Back at or above the skipped parent's indent — stop skipping
        skipIndent = -1;
      } else if (line.trim() === "") {
        // Blank line terminates the skipped item's continuation block
        skipIndent = -1;
        result.push(line);
        continue;
      } else {
        const leadingWs = line.match(/^(\s*)/)![1].length;
        if (leadingWs > skipIndent) {
          // Indented continuation (child note) of the skipped item
          continue;
        }
        skipIndent = -1;
      }
    }

    if (checkboxMatch && checkboxMatch[2] === "x") {
      skipIndent = checkboxMatch[1].length;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Normalize TODO file content to ensure proper checkbox format.
 * Fixes common LLM output mistakes:
 * - Missing checkbox: `- Item` → `- [ ] Item`
 * - Extra/missing space in brackets: `- [  ]`, `- []` → `- [ ]`
 * - Asterisk bullet: `* [ ] Item` → `- [ ] Item`
 * - Uppercase X: `- [X] Item` → `- [x] Item`
 *
 * Bullet items indented under a checkbox are treated as child descriptions
 * and left untouched.
 */
export function normalizeTodoCheckboxes(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let lastCheckboxIndent = -1;
  let inNotesSection = false;

  for (const line of lines) {
    let fixed = line;

    // Track whether we're inside a Notes section (## Notes)
    // Notes sections contain free-form text, not tasks
    const sectionMatch = fixed.match(/^## (.+)/);
    if (sectionMatch) {
      inNotesSection = /^notes$/i.test(sectionMatch[1].trim());
      lastCheckboxIndent = -1;
      result.push(fixed);
      continue;
    }

    // Normalize bullet character: * → -
    fixed = fixed.replace(/^(\s*)\* /, "$1- ");

    // Fix bracket formatting: - [] or - [  ] → - [ ]
    fixed = fixed.replace(
      /^(\s*- )\[( {0}| {2,})\](\s)/,
      "$1[ ]$3",
    );

    // Uppercase X → lowercase
    fixed = fixed.replace(/^(\s*- )\[X\]/, "$1[x]");

    // Already a valid checkbox — track indent and move on
    const checkboxMatch = fixed.match(/^(\s*)- \[([ x!~])\]\s/);
    if (checkboxMatch) {
      lastCheckboxIndent = checkboxMatch[1].length;
      result.push(fixed);
      continue;
    }

    // In Notes section — leave plain bullets as-is
    if (inNotesSection) {
      result.push(fixed);
      continue;
    }

    // Plain bullet that might need a checkbox
    const bulletMatch = fixed.match(/^(\s*)- (.+)/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;

      // Indented under a checkbox → child description, leave as-is
      if (lastCheckboxIndent >= 0 && indent > lastCheckboxIndent) {
        result.push(fixed);
        continue;
      }

      // Convert to pending checkbox
      result.push(`${bulletMatch[1]}- [ ] ${bulletMatch[2]}`);
      lastCheckboxIndent = indent;
      continue;
    }

    // Headings and blank lines reset the tracking
    if (fixed.trim() === "" || /^#/.test(fixed)) {
      lastCheckboxIndent = -1;
    }

    result.push(fixed);
  }

  return result.join("\n");
}

const STATUS_PATTERNS: [RegExp, TodoItem["status"]][] = [
  [/^(\s*)- \[x\]\s+(.*)/, "completed"],
  [/^(\s*)- \[ \]\s+(.*)/, "pending"],
  [/^(\s*)- \[!\]\s+(.*)/, "blocked"],
  [/^(\s*)- \[~\]\s+(.*)/, "in_progress"],
];

export function parseTodoItems(content: string): TodoItem[] {
  const items: TodoItem[] = [];
  for (const line of content.split("\n")) {
    let matched = false;
    for (const [pattern, status] of STATUS_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        items.push({
          text: match[2].trim(),
          status,
          indent: match[1].length,
          children: [],
        });
        matched = true;
        break;
      }
    }
    if (!matched && items.length > 0) {
      // Indented non-checkbox line → child of the last item
      const indentMatch = line.match(/^(\s+)/);
      if (indentMatch && indentMatch[1].length > items[items.length - 1].indent) {
        const trimmed = line.trim();
        if (trimmed) {
          items[items.length - 1].children.push(trimmed);
        }
      }
    }
  }
  return items;
}

export function parseTodoSections(content: string): TodoSection[] {
  const sections: TodoSection[] = [];
  let current: TodoSection | null = null;
  let lastItem: TodoItem | null = null;

  for (const line of content.split("\n")) {
    // Skip the top-level title (# TODO: ...)
    if (/^# /.test(line)) continue;

    // Section heading (## ...)
    const headingMatch = line.match(/^## (.+)/);
    if (headingMatch) {
      if (current && (current.items.length > 0 || current.notes.length > 0)) {
        sections.push(current);
      }
      current = { heading: headingMatch[1].trim(), items: [], notes: [] };
      lastItem = null;
      continue;
    }

    if (!current) {
      current = { heading: "", items: [], notes: [] };
    }

    // Try checkbox item
    let matched = false;
    for (const [pattern, status] of STATUS_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const item: TodoItem = {
          text: match[2].trim(),
          status,
          indent: match[1].length,
          children: [],
        };
        current.items.push(item);
        lastItem = item;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Non-checkbox, non-empty text
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Indented line after a checkbox item → child of that item
    const indentMatch = line.match(/^(\s+)/);
    if (lastItem && indentMatch && indentMatch[1].length > lastItem.indent) {
      lastItem.children.push(trimmed);
    } else {
      // Non-indented or no preceding item → section note
      current.notes.push(trimmed);
      lastItem = null;
    }
  }

  if (current && (current.items.length > 0 || current.notes.length > 0)) {
    sections.push(current);
  }

  return sections;
}

export function parseTodoFile(
  filename: string,
  content: string
): TodoFile {
  const items = parseTodoItems(content);
  const sections = parseTodoSections(content);
  const completed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const total = items.length;
  const progress = total > 0 ? Math.round((completed * 100) / total) : 100;

  // Extract repo name from filename: TODO-{repo}.md -> {repo}
  const repoName = filename.replace(/^TODO-/, "").replace(/\.md$/, "");

  return {
    filename,
    repoName,
    items,
    sections,
    completed,
    pending,
    blocked,
    inProgress,
    total,
    progress,
  };
}
