"use client";

import { useState, useMemo } from "react";
import { parseStreamEvent, type LogEntry } from "@/lib/parsers/stream";
import { useSubagentOutput } from "@/hooks/use-subagent-output";
import type { DisplayNode } from "./display-nodes";
import { EntryRow } from "./entries";

// ---------------------------------------------------------------------------
// Child-group section (for operation groups/pipelines)
// ---------------------------------------------------------------------------

export function ChildGroupSection({
  group,
}: {
  group: Extract<DisplayNode, { type: "child-group" }>;
}) {
  const [expanded, setExpanded] = useState(false);

  // Separate result entries (green output) from the rest so they stay visible outside the fold
  const resultNodes: DisplayNode[] = [];
  const otherNodes: DisplayNode[] = [];
  for (const node of group.children) {
    if (node.type === "entry" && node.entry.kind === "result") {
      resultNodes.push(node);
    } else {
      otherNodes.push(node);
    }
  }

  const statusColor = {
    running: "text-blue-500",
    completed: "text-green-600",
    failed: "text-red-500",
  }[group.status];

  const statusIcon = {
    running: "\u25CF",
    completed: "\u2713",
    failed: "\u2717",
  }[group.status];

  return (
    <div className="rounded-md border border-teal-200 dark:border-teal-800">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs cursor-pointer hover:bg-accent/50"
      >
        <span className="text-muted-foreground">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>
        <span className={`${statusColor} font-medium`}>{statusIcon}</span>
        <span className="font-medium text-foreground">{group.label}</span>
        <span className="text-muted-foreground">
          ({otherNodes.length} events)
        </span>
        {group.status === "running" && (
          <span className="text-blue-500 animate-pulse">...</span>
        )}
      </div>

      {expanded && otherNodes.length > 0 && (
        <div className="border-t border-teal-200 bg-teal-50/30 p-2 dark:border-teal-800 dark:bg-teal-950/20">
          <div className="space-y-1.5">
            {otherNodes.map((node, i) =>
              node.type === "entry" ? (
                <EntryRow key={i} entry={node.entry} />
              ) : node.type === "subagent" ? (
                <SubAgentSection key={node.toolUseId} group={node} />
              ) : (
                <ChildGroupSection key={node.label} group={node} />
              )
            )}
          </div>
        </div>
      )}

      {resultNodes.length > 0 && (
        <div className="border-t border-teal-200 p-2 dark:border-teal-800">
          <div className="space-y-1.5">
            {resultNodes.map((node, i) =>
              node.type === "entry" ? <EntryRow key={i} entry={node.entry} /> : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-agent section
// ---------------------------------------------------------------------------

export function SubAgentSection({
  group,
}: {
  group: Extract<DisplayNode, { type: "subagent" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasEntries = group.entries.length > 0;
  const hasOutputFile = !!group.outputFile;
  const isExpandable = hasEntries || hasOutputFile || group.status === "running";

  const output = useSubagentOutput(
    group.outputFile,
    group.status === "running",
    expanded && !hasEntries && hasOutputFile
  );

  // Parse output file content (JSON lines) into LogEntry[] just like the main stream
  const outputEntries = useMemo(() => {
    if (!output.content) return [];
    const entries: LogEntry[] = [];
    for (const line of output.content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entries.push(...parseStreamEvent(trimmed));
    }
    return entries;
  }, [output.content]);

  const statusColor = {
    running: "text-blue-500",
    completed: "text-green-600",
    failed: "text-red-500",
    stopped: "text-yellow-600",
  }[group.status];

  const statusIcon = {
    running: "\u25CF",
    completed: "\u2713",
    failed: "\u2717",
    stopped: "\u25A0",
  }[group.status];

  return (
    <div className="rounded-md border border-indigo-200 dark:border-indigo-800">
      {/* Header */}
      <div
        role={isExpandable ? "button" : undefined}
        tabIndex={isExpandable ? 0 : undefined}
        onClick={isExpandable ? () => setExpanded(!expanded) : undefined}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs${
          isExpandable ? " cursor-pointer hover:bg-accent/50" : ""
        }`}
      >
        {isExpandable ? (
          <span className="text-muted-foreground">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>
        ) : (
          <span className="w-3" />
        )}
        <span className={`${statusColor} font-medium`}>{statusIcon}</span>
        <span className="font-medium text-foreground">{group.description}</span>
        {group.usage && (
          <span className="text-muted-foreground">{group.usage}</span>
        )}
        {hasEntries && (
          <span className="text-muted-foreground">
            ({group.entries.length} events)
          </span>
        )}
        {group.status === "running" && (
          <span className="text-blue-500 animate-pulse">...</span>
        )}
      </div>

      {/* Summary from task_notification */}
      {group.summary && (
        <div className="border-t border-indigo-200 px-2.5 py-1.5 text-xs text-muted-foreground dark:border-indigo-800">
          {group.summary}
        </div>
      )}

      {/* Expanded child entries (when SDK streams sub-agent messages) */}
      {expanded && hasEntries && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          <div className="space-y-1.5">
            {group.entries.map((entry, i) => (
              <EntryRow key={i} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* Background task output file content (parsed like main log) */}
      {expanded && !hasEntries && hasOutputFile && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          {output.loading && outputEntries.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Loading output...</div>
          ) : output.error && outputEntries.length === 0 ? (
            <div className="text-xs text-red-500 italic">Failed to load output</div>
          ) : outputEntries.length > 0 ? (
            <div className="max-h-96 overflow-auto">
              <div className="space-y-1.5">
                {outputEntries.map((entry, i) => (
                  <EntryRow key={i} entry={entry} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">No output yet</div>
          )}
        </div>
      )}

      {/* Running background task with no output file yet */}
      {expanded && !hasEntries && !hasOutputFile && group.status === "running" && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          <div className="text-xs text-muted-foreground italic">
            Task running in background...
          </div>
        </div>
      )}
    </div>
  );
}
