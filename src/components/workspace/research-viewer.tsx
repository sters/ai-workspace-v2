"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { cardVariants } from "../shared/containers/card";
import { StatusText } from "../shared/feedback/status-text";

export function ResearchViewer({
  workspaceName,
  summary,
  files,
}: {
  workspaceName: string;
  summary: string;
  files: { name: string; content: string }[];
}) {
  if (!summary && files.length === 0) {
    return <StatusText>No research report found.</StatusText>;
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div>
          <div className="mb-2 flex items-center justify-end">
            <Link
              href={`/workspace/${encodeURIComponent(workspaceName)}/chat/interactive?researchChat=1`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <MessageSquare className="h-4 w-4" />
              Chat about this
            </Link>
          </div>
          <MarkdownRenderer content={summary} />
        </div>
      )}
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
