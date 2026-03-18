"use client";

import { useState, useMemo } from "react";
import { parseStreamEvent } from "@/lib/parsers/stream";
import { statusTextColors, statusIcons } from "@/lib/status-styles";
import type { LogEntry } from "@/types/claude";
import { useSubagentOutput } from "@/hooks/use-subagent-output";
import type { DisplayNode } from "@/types/claude";
import { buildDisplayNodes } from "./display-nodes";
import { EntryRow } from "./entries";

// ---------------------------------------------------------------------------
// Render a list of DisplayNode[], dispatching to the correct component
// ---------------------------------------------------------------------------

function DisplayNodeList({ nodes }: { nodes: DisplayNode[] }) {
  return (
    <div className="space-y-1.5">
      {nodes.map((node, i) =>
        node.type === "entry" ? (
          <EntryRow key={i} entry={node.entry} />
        ) : node.type === "subagent" ? (
          <SubAgentSection key={node.toolUseId} group={node} />
        ) : node.type === "child-group" ? (
          <ChildGroupSection key={node.label} group={node} />
        ) : null
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase-group section (for "all phases" view)
// ---------------------------------------------------------------------------

export function PhaseGroupSection({
  group,
}: {
  group: Extract<DisplayNode, { type: "phase-group" }>;
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs bg-muted/30">
        <span className="font-medium text-foreground">
          Phase {group.phaseIndex + 1}: {group.phaseLabel}
        </span>
      </div>
      <div className="border-t p-2">
        <DisplayNodeList nodes={group.children} />
      </div>
    </div>
  );
}

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

  const statusColor = statusTextColors[group.status];
  const statusIcon = statusIcons[group.status];

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
          <DisplayNodeList nodes={otherNodes} />
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
  const hasChildren = group.children.length > 0;
  const hasOutputFile = !!group.outputFile;
  const isExpandable = hasChildren || hasOutputFile || group.status === "running";

  const output = useSubagentOutput(
    group.outputFile,
    group.status === "running",
    expanded && !hasChildren && hasOutputFile
  );

  // Parse output file content (JSON lines) into DisplayNode[] just like the main stream
  const outputNodes = useMemo(() => {
    if (!output.content) return [];
    const entries: LogEntry[] = [];
    for (const line of output.content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entries.push(...parseStreamEvent(trimmed));
    }
    return buildDisplayNodes(entries);
  }, [output.content]);

  const statusColor = statusTextColors[group.status];
  const statusIcon = statusIcons[group.status];

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
        {hasChildren && (
          <span className="text-muted-foreground">
            ({group.children.length} events)
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

      {/* Expanded children (sub-agent messages, nested sub-agents) */}
      {expanded && hasChildren && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          <DisplayNodeList nodes={group.children} />
        </div>
      )}

      {/* Background task output file content (parsed like main log) */}
      {expanded && !hasChildren && hasOutputFile && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          {output.loading && outputNodes.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Loading output...</div>
          ) : output.error && outputNodes.length === 0 ? (
            <div className="text-xs text-red-500 italic">Failed to load output</div>
          ) : outputNodes.length > 0 ? (
            <div className="max-h-96 overflow-auto">
              <DisplayNodeList nodes={outputNodes} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">No output yet</div>
          )}
        </div>
      )}

      {/* Running background task with no output file yet */}
      {expanded && !hasChildren && !hasOutputFile && group.status === "running" && (
        <div className="border-t border-indigo-200 bg-indigo-50/30 p-2 dark:border-indigo-800 dark:bg-indigo-950/20">
          <div className="text-xs text-muted-foreground italic">
            Task running in background...
          </div>
        </div>
      )}
    </div>
  );
}
