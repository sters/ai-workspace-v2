"use client";

import { MarkdownRenderer } from "../shared/content/markdown-renderer";
import { StatusText } from "../shared/feedback/status-text";

export function ReadmeViewer({ content }: { content: string }) {
  if (!content) {
    return <StatusText>No README found.</StatusText>;
  }

  return <MarkdownRenderer content={content} />;
}
