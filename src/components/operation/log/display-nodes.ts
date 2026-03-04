import type { LogEntry, AskQuestion } from "@/types/claude";
import type { DisplayNode } from "@/types/claude";

/** Tool names that represent sub-agent spawns (CLI uses "Agent", SDK uses "Task"). */
const SUBAGENT_TOOL_NAMES = new Set(["Task", "Agent"]);

/** Extract output_file path from a background Task tool_result text. */
function extractOutputFilePath(text: string): string | undefined {
  // SDK background task results contain "output_file" or "output file" followed by an absolute path
  const match = text.match(/output_file\s*(?:path)?[:\s]\s*(\/\S+)/i)
    ?? text.match(/output\s+file\s*(?:path)?[:\s]\s*(\/\S+)/i);
  return match?.[1];
}

type TaskInfo = {
  description: string;
  status: "running" | "completed" | "failed" | "stopped";
  summary?: string;
  usage?: string;
  taskId?: string;
  outputFile?: string;
};

export function buildDisplayNodes(entries: LogEntry[]): DisplayNode[] {
  // 1. Collect task info (descriptions, statuses) from system entries
  const taskInfo = new Map<string, TaskInfo>();

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

  // 2. Find all sub-agent tool_call ids (Task or Agent)
  const taskToolUseIds = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_call" && SUBAGENT_TOOL_NAMES.has(e.toolName)) {
      taskToolUseIds.add(e.toolId);
    }
  }
  for (const e of entries) {
    if (e.parentToolUseId) {
      taskToolUseIds.add(e.parentToolUseId);
    }
  }
  for (const id of taskInfo.keys()) {
    taskToolUseIds.add(id);
  }

  // 3. Infer completion from tool_results when no task_notification was received.
  //    The CLI's Agent tool may not emit task_notification, so the tool_result
  //    for the Agent call is the only signal that the sub-agent finished.
  const toolResultIds = new Set<string>();
  const toolResultErrors = new Set<string>();
  for (const e of entries) {
    if (e.kind === "tool_result" && taskToolUseIds.has(e.toolId)) {
      toolResultIds.add(e.toolId);
      if (e.isError) toolResultErrors.add(e.toolId);

      // Extract output_file from background Task tool_results
      if (e.content) {
        const outputFile = extractOutputFilePath(e.content);
        if (outputFile) {
          const existing = taskInfo.get(e.toolId);
          if (existing) {
            existing.outputFile = existing.outputFile ?? outputFile;
          }
        }
      }
    }
  }

  // Update taskInfo status for sub-agents that have a tool_result but no
  // task_notification (status is still "running")
  for (const id of toolResultIds) {
    const info = taskInfo.get(id);
    if (info && info.status === "running") {
      info.status = toolResultErrors.has(id) ? "failed" : "completed";
    }
  }

  // 4. Bucket ALL entries by parentToolUseId (null key = top-level)
  const buckets = new Map<string | null, LogEntry[]>();
  buckets.set(null, []);
  for (const id of taskToolUseIds) {
    buckets.set(id, []);
  }

  for (const e of entries) {
    // Skip system task entries (shown in section header)
    if (e.kind === "system" && e.taskToolUseId && taskToolUseIds.has(e.taskToolUseId)) {
      continue;
    }
    // Skip tool_progress for tasks (handled in section)
    if (e.kind === "tool_progress" && e.taskId) {
      continue;
    }

    const pid = e.parentToolUseId ?? null;
    if (pid && buckets.has(pid)) {
      buckets.get(pid)!.push(e);
    } else {
      buckets.get(null)!.push(e);
    }
  }

  // 5. Build nodes recursively from a bucket
  function buildFromBucket(bucketKey: string | null): DisplayNode[] {
    const bucketEntries = buckets.get(bucketKey) ?? [];
    const nodes: DisplayNode[] = [];
    const emitted = new Set<string>();

    for (const e of bucketEntries) {
      // Sub-agent tool_call → emit sub-agent section with recursively built children
      if (e.kind === "tool_call" && SUBAGENT_TOOL_NAMES.has(e.toolName) && !emitted.has(e.toolId)) {
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
          children: buildFromBucket(e.toolId),
        });
        continue;
      }

      // tool_result for a sub-agent — skip (status shown in section header)
      if (e.kind === "tool_result" && taskToolUseIds.has(e.toolId)) {
        continue;
      }

      // Regular entry
      nodes.push({ type: "entry", entry: e });
    }

    return nodes;
  }

  const nodes = buildFromBucket(null);

  // 6. Emit orphan sub-agent groups (task_started arrived but no tool_call was seen)
  const emittedInTree = new Set<string>();
  function collectEmitted(nodeList: DisplayNode[]) {
    for (const n of nodeList) {
      if (n.type === "subagent") {
        emittedInTree.add(n.toolUseId);
        collectEmitted(n.children);
      } else if (n.type === "child-group") {
        collectEmitted(n.children);
      }
    }
  }
  collectEmitted(nodes);

  for (const id of taskToolUseIds) {
    if (!emittedInTree.has(id)) {
      const info = taskInfo.get(id);
      const childNodes = buildFromBucket(id);
      if (info || childNodes.length > 0) {
        nodes.push({
          type: "subagent",
          toolUseId: id,
          description: info?.description ?? `Sub-agent ${id.slice(0, 8)}`,
          status: info?.status ?? "running",
          summary: info?.summary,
          usage: info?.usage,
          taskId: info?.taskId,
          outputFile: info?.outputFile,
          children: childNodes,
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
    for (const child of node.children) {
      const label = getChildLabel(child);
      if (label) return label;
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
