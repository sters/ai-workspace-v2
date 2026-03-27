"use client";

import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { cardVariants } from "../shared/containers/card";
import { StatusText } from "../shared/feedback/status-text";

export function ResearchViewer({
  summary,
  files,
}: {
  summary: string;
  files: { name: string; content: string }[];
}) {
  if (!summary && files.length === 0) {
    return <StatusText>No research report found.</StatusText>;
  }

  return (
    <div className="space-y-4">
      {summary && <MarkdownRenderer content={summary} />}
      {files.length > 0 && (
        <div className="space-y-4">
          {files.map((f) => (
            <details key={f.name} className={cardVariants("flush")}>
              <summary className="cursor-pointer px-4 py-2 font-medium hover:bg-accent">
                {f.name}
              </summary>
              <div className="border-t px-4 py-3">
                <MarkdownRenderer content={f.content} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
