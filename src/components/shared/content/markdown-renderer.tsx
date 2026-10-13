"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

function ExternalLink(props: ComponentPropsWithoutRef<"a">) {
  const { href, children, ...rest } = props;
  const isExternal =
    href && (href.startsWith("http://") || href.startsWith("https://"));
  return (
    <a
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * `allowHtml` renders raw HTML in the source (e.g. `<details>` in GitHub comments), sanitized to
 * GitHub's own allow-list. Leave it off for content where `<…>` is meant as literal text.
 */
export function MarkdownRenderer({
  content,
  allowHtml = false,
}: {
  content: string;
  allowHtml?: boolean;
}) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={allowHtml ? [rehypeRaw, rehypeSanitize] : undefined}
        components={{ a: ExternalLink }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
