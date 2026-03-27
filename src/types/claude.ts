import type { OperationEvent, OperationStatus } from "./operation";
import type { DataListener } from "./pty";

/** Known Claude model short aliases accepted by the CLI --model flag. */
export const CLAUDE_MODELS = {
  OPUS: "opus",
  SONNET: "sonnet",
  HAIKU: "haiku",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

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
  /** Working directory for the spawned process. Defaults to getResolvedWorkspaceRoot(). */
  cwd?: string;
  /** Additional directories to expose via --add-dir. */
  addDirs?: string[];
  /** When true, let the CLI auto-error response to AskUserQuestion flow through instead of killing the process and waiting for user input. Claude will see the error and continue without the user's answer. */
  skipAskUserQuestion?: boolean;
  /** Claude model to use (e.g. "opus", "sonnet", "haiku"). Passed as --model to CLI. */
  model?: ClaudeModel;
  /** Path to a file whose content is appended to Claude's system prompt via --append-system-prompt-file. */
  appendSystemPromptFile?: string;
}

// TODO: Replace with Record<string, unknown> or a discriminated union once
// cli.ts property accesses are updated with proper type narrowing.
// Currently `any` because cli.ts accesses deeply nested properties without guards.
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
    | { kind: "ask"; toolId: string; questions: AskQuestion[]; allowFreeText?: boolean }
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
    | {
        kind: "permission_denial";
        toolName: string;
        toolInput?: Record<string, unknown>;
        permissionString: string;
        summary: string;
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
      /** Child display nodes (sub-agent messages, including nested sub-agents). */
      children: DisplayNode[];
    }
  | {
      type: "child-group";
      label: string;
      status: OperationStatus;
      children: DisplayNode[];
    }
  | {
      type: "phase-group";
      phaseIndex: number;
      phaseLabel: string;
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

export type McpServerTools = {
  name: string;
  tools: string[];
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
