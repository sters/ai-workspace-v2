"use client";

import { useState } from "react";
import type { LogEntry } from "@/types/claude";
import { Button } from "../../shared/buttons/button";
import { MarkdownRenderer } from "../../shared/content/markdown-renderer";
import { Callout } from "../../shared/containers/callout";
import { ResultBox } from "../../shared/feedback/result-box";

// ---------------------------------------------------------------------------
// Entry renderers
// ---------------------------------------------------------------------------

export function EntryRow({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "text":
      return (
        <div className="rounded-md border-l-2 border-blue-400 bg-blue-50/50 py-1 pl-3 pr-2 dark:bg-blue-950/30">
          <MarkdownRenderer content={entry.content} />
        </div>
      );
    case "thinking":
      return <ThinkingRow content={entry.content} />;
    case "tool_call":
      return (
        <div className="flex items-start gap-2 font-mono text-xs text-muted-foreground">
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-semibold">
            {entry.toolName}
          </span>
          <span className="truncate">{entry.summary}</span>
        </div>
      );
    case "tool_result":
      if (!entry.content) return null;
      return (
        <CollapsibleRow
          content={entry.content}
          className={entry.isError ? "text-red-400" : "text-muted-foreground"}
        />
      );
    case "ask":
      return (
        <Callout variant="warning" className="rounded-md">
          {entry.questions.map((q, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <p className="font-medium">{q.question}</p>
              {q.options.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {q.options.map((o, j) => (
                    <li key={j}>
                      <span className="font-medium">{o.label}</span>
                      {o.description && <span> &mdash; {o.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Callout>
      );
    case "result":
      return (
        <ResultBox
          content={entry.content}
          cost={entry.cost}
          duration={entry.duration}
        />
      );
    case "system":
      return (
        <div className="whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground italic">
          {entry.content}
        </div>
      );
    case "error":
      return (
        <div className="whitespace-pre-wrap text-red-500">
          {entry.content}
        </div>
      );
    case "complete": {
      const ok = entry.exitCode === 0;
      return (
        <div
          className={`text-xs font-medium ${ok ? "text-green-600" : "text-red-500"}`}
        >
          Process exited ({entry.exitCode})
        </div>
      );
    }
    case "tool_progress":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono font-semibold">
            {entry.toolName}
          </span>
          <span>{entry.elapsed.toFixed(0)}s elapsed</span>
        </div>
      );
    case "permission_denial":
      return (
        <PermissionDenialRow
          toolName={entry.toolName}
          summary={entry.summary}
        />
      );
    case "raw":
      return (
        <div className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {entry.content}
        </div>
      );
  }
}

export function ThinkingRow({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.split("\n").slice(0, 2).join("\n");
  const isLong = content.length > 200;

  return (
    <div className="rounded-md border border-purple-200 bg-purple-50 p-2 text-xs text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-200">
      <Button
        variant="ghost-toggle"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 font-medium"
      >
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>Thinking</span>
      </Button>
      {expanded && (
        <div className="mt-1 whitespace-pre-wrap">{content}</div>
      )}
      {!expanded && isLong && (
        <div className="mt-1 truncate opacity-60">{preview}</div>
      )}
    </div>
  );
}

export function CollapsibleRow({
  content,
  className,
}: {
  content: string;
  className: string;
}) {
  const lines = content.split("\n");
  const [expanded, setExpanded] = useState(false);
  const preview = lines[0]?.slice(0, 80) || "";

  return (
    <div className={`font-mono text-xs ${className}`}>
      <Button
        variant="ghost-toggle"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 font-medium"
      >
        <span>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="truncate opacity-70">
          {preview}
          {(lines[0]?.length ?? 0) > 80 ? "\u2026" : ""}
        </span>
        <span className="shrink-0 text-muted-foreground">
          ({lines.length} lines)
        </span>
      </Button>
      {expanded && (
        <div className="mt-1 max-h-96 overflow-auto whitespace-pre rounded border bg-muted/30 p-2">
          {content}
        </div>
      )}
    </div>
  );
}

function PermissionDenialRow({
  toolName,
  summary,
}: {
  toolName: string;
  summary: string;
}) {
  return (
    <Callout variant="warning" className="rounded-md">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          Permission denied: {toolName}
        </p>
        {summary && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {summary}
          </p>
        )}
      </div>
    </Callout>
  );
}
