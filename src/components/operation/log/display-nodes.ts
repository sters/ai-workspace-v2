import type { LogEntry, AskQuestion } from "@/types/claude";
import type { DisplayNode } from "@/types/claude";

/** Extract output_file path from a background Task tool_result text. */
function extractOutputFilePath(text: string): string | undefined {
  // SDK background task results contain "output_file" or "output file" followed by an absolute path
  const match = text.match(/output_file\s*(?:path)?[:\s]\s*(\/\S+)/i)
    ?? text.match(/output\s+file\s*(?:path)?[:\s]\s*(\/\S+)/i);
  return match?.[1];
}

export function buildDisplayNodes(entries: LogEntry[]): DisplayNode[] {
  const nodes: DisplayNode[] = [];

  // Collect task_started descriptions and task_notification data by toolUseId
  const taskInfo = new Map<
    string,
    {
      description: string;
      status: "running" | "completed" | "failed" | "stopped";
      summary?: string;
      usage?: string;
      taskId?: string;
      outputFile?: string;
    }
  >();

  for (const e of entries) {
    if (e.kind === "system" && e.taskToolUseId) {
      const existing = taskInfo.get(e.taskToolUseId);
      if (e.taskStatus === "running") {
        taskInfo.set(e.taskToolUseId, {
          description: e.content.replace(/^Task started:\s*/, ""),
          status: "running",
          taskId: e.taskId ?? existing?.taskId,
        });
      } else if (e.taskStatus) {
        taskInfo.set(e.taskToolUseId, {
          description: existing?.description ?? e.content,
          status: e.taskStatus as "completed" | "failed" | "stopped",
          summary: e.taskSummary,
          usage: e.taskUsage,
          taskId: e.taskId ?? existing?.taskId,
          outputFile: e.taskOutputFile ?? existing?.outputFile,
        });
      }
    }
  }

  // Find all Task tool_call ids (these are parent tool_use_ids for sub-agents)
  const taskToolUseIds = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_call" && e.toolName === "Task") {
      taskToolUseIds.add(e.toolId);
    }
  }
  // Also add any parent IDs seen on entries
  for (const e of entries) {
    if (e.parentToolUseId) {
      taskToolUseIds.add(e.parentToolUseId);
    }
  }
  // Also add task_started toolUseIds
  for (const id of taskInfo.keys()) {
    taskToolUseIds.add(id);
  }

  // Extract output_file from background Task tool_results (returned immediately when
  // run_in_background is true, before task_notification arrives)
  for (const e of entries) {
    if (e.kind === "tool_result" && taskToolUseIds.has(e.toolId) && e.content) {
      const outputFile = extractOutputFilePath(e.content);
      if (outputFile) {
        const existing = taskInfo.get(e.toolId);
        if (existing) {
          existing.outputFile = existing.outputFile ?? outputFile;
        }
      }
    }
  }

  // Bucket sub-agent entries
  const subagentEntries = new Map<string, LogEntry[]>();
  for (const id of taskToolUseIds) {
    subagentEntries.set(id, []);
  }

  // Track which toolUseIds have their sub-agent section already emitted
  const emitted = new Set<string>();

  for (const e of entries) {
    const pid = e.parentToolUseId;

    // Skip task_started/task_notification system entries — they're shown in the section header
    if (e.kind === "system" && e.taskToolUseId && taskToolUseIds.has(e.taskToolUseId)) {
      // If this is a task_notification (not running), ensure we still emit the group
      if (!emitted.has(e.taskToolUseId)) {
        // Don't emit here — it'll be emitted when we encounter the Task tool_call
      }
      continue;
    }

    // Sub-agent entry
    if (pid && subagentEntries.has(pid)) {
      subagentEntries.get(pid)!.push(e);
      continue;
    }

    // Top-level Task tool_call → emit the sub-agent section
    if (e.kind === "tool_call" && e.toolName === "Task" && !emitted.has(e.toolId)) {
      emitted.add(e.toolId);
      const info = taskInfo.get(e.toolId);
      nodes.push({
        type: "subagent",
        toolUseId: e.toolId,
        description: info?.description ?? e.summary,
        status: info?.status ?? "running",
        summary: info?.summary,
        usage: info?.usage,
        taskId: info?.taskId,
        outputFile: info?.outputFile,
        entries: subagentEntries.get(e.toolId) ?? [],
      });
      continue;
    }

    // Top-level tool_result for a Task — skip (already in the section header status)
    if (e.kind === "tool_result" && taskToolUseIds.has(e.toolId)) {
      continue;
    }

    // tool_progress for a task — skip (handled in section)
    if (e.kind === "tool_progress" && e.taskId) {
      continue;
    }

    // Regular top-level entry
    nodes.push({ type: "entry", entry: e });
  }

  // Emit any sub-agent groups that weren't tied to a Task tool_call
  // (e.g., task_started arrived but no Task tool_call was seen yet)
  for (const id of taskToolUseIds) {
    if (!emitted.has(id)) {
      const info = taskInfo.get(id);
      const childEntries = subagentEntries.get(id) ?? [];
      // Only emit if we have task info or child entries
      if (info || childEntries.length > 0) {
        emitted.add(id);
        nodes.push({
          type: "subagent",
          toolUseId: id,
          description: info?.description ?? `Sub-agent ${id.slice(0, 8)}`,
          status: info?.status ?? "running",
          summary: info?.summary,
          usage: info?.usage,
          taskId: info?.taskId,
          outputFile: info?.outputFile,
          entries: childEntries,
        });
      }
    }
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Group by childLabel (for operation groups/pipelines)
// ---------------------------------------------------------------------------

function getChildLabel(node: DisplayNode): string | undefined {
  if (node.type === "entry") return node.entry.childLabel;
  if (node.type === "subagent") {
    for (const entry of node.entries) {
      if (entry.childLabel) return entry.childLabel;
    }
  }
  return undefined;
}

export function groupByChildLabel(nodes: DisplayNode[]): DisplayNode[] {
  const labelOrder: string[] = [];
  const labelNodes = new Map<string, DisplayNode[]>();
  const result: DisplayNode[] = [];

  for (const node of nodes) {
    const label = getChildLabel(node);
    if (label) {
      if (!labelNodes.has(label)) {
        labelOrder.push(label);
        labelNodes.set(label, []);
      }
      labelNodes.get(label)!.push(node);
    } else {
      // Non-labeled nodes go directly to result
      result.push(node);
    }
  }

  // No child-label groups needed
  if (labelOrder.length === 0) return nodes;

  for (const label of labelOrder) {
    const children = labelNodes.get(label)!;
    // Determine group status
    let status: "running" | "completed" | "failed" = "completed";
    let hasComplete = false;
    for (const child of children) {
      if (child.type === "entry" && child.entry.kind === "complete") {
        hasComplete = true;
        if (child.entry.exitCode !== 0) { status = "failed"; break; }
      }
      if (child.type === "subagent" && child.status === "failed") { status = "failed"; break; }
      if (child.type === "subagent" && child.status === "running") { status = "running"; }
    }
    if (!hasComplete && status !== "failed") status = "running";

    result.push({ type: "child-group", label, status, children });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Find pending ask
// ---------------------------------------------------------------------------

/** Find the latest "ask" entry that doesn't have a subsequent tool_result for the same toolId. */
export function findPendingAsk(
  entries: LogEntry[]
): { toolId: string; questions: AskQuestion[]; allowFreeText: boolean } | null {
  const answeredIds = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_result") {
      answeredIds.add(e.toolId);
    }
  }

  // Walk backward to find the latest unanswered ask
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "ask" && !answeredIds.has(e.toolId)) {
      return { toolId: e.toolId, questions: e.questions, allowFreeText: e.allowFreeText ?? true };
    }
  }

  return null;
}
