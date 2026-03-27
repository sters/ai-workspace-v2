"use client";

import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusText } from "../shared/feedback/status-text";

export function ResearchViewer({ content }: { content: string }) {
  if (!content) {
    return <StatusText>No research report found.</StatusText>;
  }

  return <MarkdownRenderer content={content} />;
}
