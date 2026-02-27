import type { OperationEvent, OperationStatus } from "./operation";
import type { DataListener } from "./pty";

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

export interface AskQuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
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
      status: OperationStatus | "stopped";
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
      status: OperationStatus;
      children: DisplayNode[];
    };

// ---------------------------------------------------------------------------
// CLI spawn types
// ---------------------------------------------------------------------------

export interface SpawnClaudeOptions {
  args: string[];
  cwd?: string;
  stdin?: "pipe" | undefined;
  env?: Record<string, string | undefined>;
}

export interface SpawnClaudeTerminalOptions {
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  listeners: Set<DataListener>;
  cols?: number;
  rows?: number;
}

export type McpConnectionStatus = {
  name: string;
  status: "ok" | "needs_auth" | "error" | "unknown";
  statusText: string;
};

// ---------------------------------------------------------------------------
// MCP server config types
// ---------------------------------------------------------------------------

export type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

export type McpAuthStatus = {
  hasAuth: boolean;
  authType: "env" | "headers" | "none";
  keyCount: number;
};

export type McpServerEntry = {
  name: string;
  scope: "user" | "project" | "local";
  config: McpServerConfig;
  authStatus: McpAuthStatus;
};

// ---------------------------------------------------------------------------
// Settings types
// ---------------------------------------------------------------------------

export const SETTINGS_SCOPES = ["project", "local", "user"] as const;
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

export type SettingsFileInfo = {
  scope: SettingsScope;
  filePath: string;
  exists: boolean;
  content: string | null;
  error: string | null;
};
