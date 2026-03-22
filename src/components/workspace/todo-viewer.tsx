"use client";

import type { TodoSection } from "@/types/workspace";
import { TodoItemRow } from "./todo-item";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";

const NOTE_SECTION_RE = /notes/i;

export function SectionBlock({ section }: { section: TodoSection }) {
  const isNoteSection =
    NOTE_SECTION_RE.test(section.heading) && section.items.length === 0;

  if (isNoteSection) {
    return (
      <div className="rounded-md bg-blue-50 px-3 py-2 text-xs dark:bg-blue-950/30 [&_.prose]:text-xs [&_.prose]:text-blue-700 [&_.prose_strong]:text-blue-700 dark:[&_.prose]:text-blue-300 dark:[&_.prose_strong]:text-blue-300">
        {section.heading && (
          <p className="mb-1 text-xs font-medium uppercase text-blue-600 dark:text-blue-400">
            {section.heading}
          </p>
        )}
        <MarkdownRenderer content={section.notes.join("\n")} />
      </div>
    );
  }

  return (
    <div>
      {section.heading && (
        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
          {section.heading}
        </p>
      )}
      {section.items.length > 0 && (
        <div className="space-y-0.5">
          {section.items.map((item, i) => (
            <TodoItemRow key={i} item={item} />
          ))}
        </div>
      )}
      {section.notes.length > 0 && (
        <div className="mt-1 border-l-2 border-muted pl-3 text-xs text-muted-foreground [&_.prose]:text-xs [&_.prose]:text-muted-foreground">
          <MarkdownRenderer content={section.notes.join("\n")} />
        </div>
      )}
    </div>
  );
}
