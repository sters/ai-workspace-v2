import type { OperationEvent } from "./operation";

export interface ClaudeProcess {
  id: string;
  onEvent: (handler: (event: OperationEvent) => void) => void;
  kill: () => void;
  submitAnswer: (toolUseId: string, answers: Record<string, string>) => boolean;
  /** Returns the model's final text response (captured from the result event). */
  getResultText: () => string | undefined;
}

export interface RunClaudeOptions {
  /** JSON Schema to constrain the model's final text response via --json-schema. */
  jsonSchema?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StreamEvent = Record<string, any>;

export type LogEntryBase = {
  /** Non-null when the entry originates from a sub-agent (Task tool). */
  parentToolUseId?: string | null;
  /** Label for grouping entries in operation groups/pipelines. */
  childLabel?: string;
  /** Phase index for pipeline operations. */
  phaseIndex?: number;
  /** Phase label for pipeline operations. */
  phaseLabel?: string;
};

export type LogEntry = LogEntryBase &
  (
    | { kind: "text"; content: string }
    | { kind: "thinking"; content: string }
    | { kind: "tool_call"; toolName: string; toolId: string; summary: string }
    | { kind: "tool_result"; toolId: string; content: string; isError: boolean }
    | { kind: "ask"; toolId: string; questions: AskQuestion[] }
    | { kind: "result"; content: string; cost?: string; duration?: string }
    | {
        kind: "system";
        content: string;
        /** Set on task_started / task_notification entries. */
        taskToolUseId?: string;
        taskStatus?: string;
        /** Raw summary from task_notification. */
        taskSummary?: string;
        /** Formatted usage string from task_notification (e.g., "12.3s, 5 tools"). */
        taskUsage?: string;
        /** Task ID from the SDK. */
        taskId?: string;
        /** Output file path for background tasks. */
        taskOutputFile?: string;
      }
    | { kind: "error"; content: string }
    | { kind: "complete"; exitCode: number }
    | { kind: "raw"; content: string }
    | {
        kind: "tool_progress";
        toolUseId: string;
        toolName: string;
        elapsed: number;
        taskId?: string;
      }
  );

export interface AskQuestion {
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

/**
 * A display node in the log tree.
 * Top-level entries render directly; sub-agent groups render as collapsible sections.
 */
export type DisplayNode =
  | { type: "entry"; entry: LogEntry }
  | {
      type: "subagent";
      toolUseId: string;
      description: string;
      status: "running" | "completed" | "failed" | "stopped";
      /** Summary text from task_notification. */
      summary?: string;
      /** Formatted usage (e.g., "12.3s, 5 tools"). */
      usage?: string;
      /** Task ID from the SDK. */
      taskId?: string;
      /** Output file path for background tasks. */
      outputFile?: string;
      /** Sub-agent messages (if any come through the SDK stream). */
      entries: LogEntry[];
    }
  | {
      type: "child-group";
      label: string;
      status: "running" | "completed" | "failed";
      children: DisplayNode[];
    };

export type McpConnectionStatus = {
  name: string;
  status: "ok" | "needs_auth" | "error" | "unknown";
  statusText: string;
};

export type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: Record<string, unknown>;
};
