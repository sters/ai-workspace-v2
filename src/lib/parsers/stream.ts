// Parse stream-json messages from `claude -p --output-format stream-json` (or SDK) into displayable log entries.

import type { LogEntry } from "@/types/claude";
import type { OperationEvent } from "@/types/operation";
import { askQuestionItemSchema, permissionDenialItemSchema } from "../runtime-schemas";

/**
 * Build a permission string suitable for `settings.local.json` `permissions.allow`.
 * For Bash, extracts the command prefix: `Bash(git:*)`.
 * For other tools, returns the tool name as-is: `Edit`, `Write`, etc.
 * @param bashCommand - The raw bash command string (for Bash tools only).
 */
export function buildPermissionString(toolName: string, bashCommand?: string): string {
  if (toolName === "Bash" && bashCommand) {
    const prefix = bashCommand.split(/\s+/)[0];
    if (prefix) return `Bash(${prefix}:*)`;
  }
  return toolName;
}

/**
 * Detect whether a tool_result error message indicates a permission denial.
 * Matches patterns emitted by Claude Code CLI when a tool is not in the allow list.
 */
const PERMISSION_DENIAL_PATTERNS = [
  /requires? (?:explicit )?approval/i,
  /haven't granted it yet/i,
  /was blocked/i,
];

export function isPermissionDenialMessage(text: string): boolean {
  // Exclude sibling-error wrappers
  if (text.includes("Sibling tool call errored")) return false;
  return PERMISSION_DENIAL_PATTERNS.some((p) => p.test(text));
}

/**
 * Post-process entries to detect permission denials from tool_result errors.
 * Correlates tool_result (is_error) with the preceding tool_call by toolId
 * to produce `permission_denial` entries with actionable information.
 */
export function enrichPermissionDenials(entries: LogEntry[]): LogEntry[] {
  // Build map: toolId → { toolName, summary }
  const toolCalls = new Map<string, { toolName: string; summary: string }>();
  for (const e of entries) {
    if (e.kind === "tool_call") {
      toolCalls.set(e.toolId, { toolName: e.toolName, summary: e.summary });
    }
  }

  const result: LogEntry[] = [];
  for (const e of entries) {
    if (e.kind === "tool_result" && e.isError && isPermissionDenialMessage(e.content)) {
      const call = toolCalls.get(e.toolId);
      if (call) {
        // Extract bash command from summary ("$ cmd args..." → "cmd args...")
        const bashCmd = call.toolName === "Bash"
          ? call.summary.replace(/^\$\s*/, "")
          : undefined;
        result.push({
          kind: "permission_denial",
          toolName: call.toolName,
          permissionString: buildPermissionString(call.toolName, bashCmd),
          summary: call.summary,
          parentToolUseId: e.parentToolUseId,
          childLabel: e.childLabel,
          phaseIndex: e.phaseIndex,
          phaseLabel: e.phaseLabel,
        });
        continue;
      }
    }
    result.push(e);
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeToolInput(name: string, input: any): string {
  switch (name) {
    case "Bash":
      return `$ ${input?.command ?? ""}`;
    case "Read":
    case "Write":
    case "Edit":
      return input?.file_path ?? "";
    case "Glob":
      return input?.pattern ?? "";
    case "Grep":
      return `/${input?.pattern ?? ""}/`;
    case "Task":
    case "Agent":
      return input?.description ?? input?.prompt?.slice(0, 80) ?? "";
    case "WebFetch":
      return input?.url ?? "";
    case "WebSearch":
      return input?.query ?? "";
    case "StructuredOutput": {
      const json = JSON.stringify(input);
      return json.length > 120 ? json.slice(0, 120) + "…" : json;
    }
    default:
      return "";
  }
}

export function parseStreamEvent(raw: string): LogEntry[] {
  // Skip debug lines from Claude CLI (not valid JSON)
  if (raw.startsWith("[debug]")) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("[stream-parser] JSON parse failed:", err);
    return [{ kind: "raw", content: raw }];
  }

  const entries: LogEntry[] = [];

  // SDK auth_status message: { type: "auth_status", error?: string }
  if (parsed.type === "auth_status") {
    if (parsed.error) {
      entries.push({
        kind: "error",
        content: `Authentication failed: ${parsed.error}\nRun "claude login" in your terminal to re-authenticate.`,
      });
    }
    return entries;
  }

  const parentId = parsed.parent_tool_use_id ?? null;

  // SDK assistant message: { type: "assistant", message: { content: [...] } }
  if (parsed.type === "assistant" && parsed.message?.content) {
    // Check for authentication or API errors on the message
    if (parsed.error) {
      const hint = parsed.error === "authentication_failed"
        ? '\nRun "claude login" in your terminal to re-authenticate.'
        : "";
      entries.push({
        kind: "error",
        content: `API error: ${parsed.error}${hint}`,
        parentToolUseId: parentId,
      });
    }
    for (const block of parsed.message.content) {
      if (block.type === "thinking" && block.thinking) {
        entries.push({ kind: "thinking", content: block.thinking, parentToolUseId: parentId });
      } else if (block.type === "text" && block.text) {
        entries.push({ kind: "text", content: block.text, parentToolUseId: parentId });
      } else if (block.type === "tool_use") {
        if (block.name === "AskUserQuestion" && block.input?.questions) {
          const rawQuestions: unknown[] = Array.isArray(block.input.questions) ? block.input.questions : [];
          const questions = rawQuestions.flatMap((q) => {
            const r = askQuestionItemSchema.safeParse(q);
            return r.success ? [r.data] : [];
          });
          entries.push({
            kind: "ask",
            toolId: block.id,
            questions,
            allowFreeText: block.input.allowFreeText ?? true,
            parentToolUseId: parentId,
          });
        } else {
          entries.push({
            kind: "tool_call",
            toolName: block.name,
            toolId: block.id,
            summary: summarizeToolInput(block.name, block.input),
            parentToolUseId: parentId,
          });
        }
      }
    }
  }
  // SDK user message (tool results): { type: "user", message: { content: [...] } }
  else if (parsed.type === "user" && parsed.message?.content) {
    const content = parsed.message.content;
    const blocks = Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block.type === "tool_result") {
        const text =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .map((c: unknown) => (c && typeof c === "object" && "text" in c ? (c as { text: string }).text : ""))
                  .filter(Boolean)
                  .join("\n")
              : "";
        entries.push({
          kind: "tool_result",
          toolId: block.tool_use_id,
          content: text,
          isError: !!block.is_error,
          parentToolUseId: parentId,
        });
      }
    }
  }
  // SDK tool_progress: { type: "tool_progress", tool_use_id, tool_name, elapsed_time_seconds, task_id? }
  else if (parsed.type === "tool_progress") {
    entries.push({
      kind: "tool_progress",
      toolUseId: parsed.tool_use_id,
      toolName: parsed.tool_name,
      elapsed: parsed.elapsed_time_seconds ?? 0,
      taskId: parsed.task_id,
      parentToolUseId: parentId,
    });
  }
  // SDK result message: { type: "result", subtype: "success"|"error_*", ... }
  else if (parsed.type === "result") {
    const parts: string[] = [];
    if (parsed.result) {
      parts.push(parsed.result);
    }
    if (parsed.is_error && parsed.errors?.length) {
      parts.push(...parsed.errors);
    }
    const cost = parsed.total_cost_usd != null
      ? `$${parsed.total_cost_usd.toFixed(4)}`
      : undefined;
    const duration = parsed.duration_ms != null
      ? `${(parsed.duration_ms / 1000).toFixed(1)}s`
      : undefined;
    if (parts.length > 0 || cost || duration) {
      entries.push({
        kind: "result",
        content: parts.join("\n") || (parsed.subtype === "success" ? "Completed" : `Error: ${parsed.subtype}`),
        cost,
        duration,
      });
    }

    // Parse permission denials from result event (if CLI includes them)
    if (Array.isArray(parsed.permission_denials)) {
      for (const raw of parsed.permission_denials) {
        const r = permissionDenialItemSchema.safeParse(raw);
        if (!r.success) continue;
        const toolName = r.data.tool_name;
        const toolInput: Record<string, unknown> = (r.data.tool_input as Record<string, unknown>) ?? {};
        entries.push({
          kind: "permission_denial",
          toolName,
          toolInput,
          permissionString: buildPermissionString(toolName, toolInput?.command as string | undefined),
          summary: summarizeToolInput(toolName, toolInput),
        });
      }
    }
  }
  // SDK system messages
  else if (parsed.type === "system") {
    if (parsed.subtype === "initializing") {
      entries.push({
        kind: "system",
        content: "Session initializing...",
      });
    } else if (parsed.subtype === "init") {
      entries.push({
        kind: "system",
        content: `Session initialized (model: ${parsed.model ?? "unknown"}, session: ${parsed.session_id ?? "unknown"})`,
      });
    } else if (parsed.subtype === "task_started") {
      entries.push({
        kind: "system",
        content: `Task started: ${parsed.description ?? parsed.task_id}`,
        taskToolUseId: parsed.tool_use_id,
        taskStatus: "running",
        taskId: parsed.task_id,
      });
    } else if (parsed.subtype === "task_notification") {
      const usageInfo: string[] = [];
      if (parsed.usage) {
        if (parsed.usage.duration_ms) usageInfo.push(`${(parsed.usage.duration_ms / 1000).toFixed(1)}s`);
        if (parsed.usage.tool_uses) usageInfo.push(`${parsed.usage.tool_uses} tools`);
      }
      const usageSuffix = usageInfo.length > 0 ? ` (${usageInfo.join(", ")})` : "";
      const summary = parsed.summary ? `: ${parsed.summary}` : "";
      entries.push({
        kind: "system",
        content: `Task ${parsed.status}${summary}${usageSuffix}`,
        taskToolUseId: parsed.tool_use_id,
        taskStatus: parsed.status,
        taskSummary: parsed.summary || undefined,
        taskUsage: usageInfo.length > 0 ? usageInfo.join(", ") : undefined,
        taskId: parsed.task_id,
        taskOutputFile: parsed.output_file,
      });
    }
    // Other system subtypes (status, hook_*, compact_boundary) are silently skipped
  }
  // SDK tool_use_summary message
  else if (parsed.type === "tool_use_summary" && parsed.summary) {
    entries.push({ kind: "text", content: parsed.summary });
  }

  return entries;
}

/**
 * Extract the last result (content, cost, duration) from a list of OperationEvents.
 * Scans events in reverse to find the last "result" entry efficiently.
 */
export function extractLastResult(
  events: OperationEvent[],
): { content: string; cost?: string; duration?: string } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "output") continue;
    const entries = parseStreamEvent(event.data);
    for (let j = entries.length - 1; j >= 0; j--) {
      const entry = entries[j];
      if (entry.kind === "result") {
        return { content: entry.content, cost: entry.cost, duration: entry.duration };
      }
    }
  }
  return undefined;
}
