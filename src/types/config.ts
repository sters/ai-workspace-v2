import type { ClaudeEffort, ClaudeModel } from "./claude";
import type { OperationType } from "./operation";
import type { InteractionLevel } from "./prompts";

/** Per-step settings within an operation type override. */
export interface StepSettings {
  model?: ClaudeModel;
}

/** Settings that can be overridden per operation type. */
export interface OperationTypeSettings {
  claudeTimeoutMinutes: number;
  functionTimeoutMinutes: number;
  defaultInteractionLevel: InteractionLevel;
  /** Best-of-N parallel execution count. 0 = disabled, 2-5 = parallel count. */
  bestOfN: number;
  /** Number of TODO groups to process per batch in execute operations. */
  batchSize: number;
  /** Default Claude model for this operation type. */
  model?: ClaudeModel;
  /** Per-step model overrides within this operation type. */
  steps?: Record<string, StepSettings>;
}

export interface AppConfig {
  workspaceRoot: string | null;

  server: {
    port: number;
    chatPort: number;
    /** Disable Next.js dev-mode incoming-request access logs. */
    disableAccessLog: boolean;
  };

  claude: {
    path: string | null;
    useCli: boolean;
  };

  operations: OperationTypeSettings & {
    maxConcurrent: number;
    /** Per-operation-type setting overrides. Keys are OperationType values. */
    typeOverrides: Partial<Record<OperationType, Partial<OperationTypeSettings>>>;
  };

  /** Settings for the interactive WebSocket chat sessions. */
  chat: {
    /** Default Claude model. null = CLI default. */
    model: ClaudeModel | null;
  };

  /** Settings for the one-shot quick-ask feature. */
  quickAsk: {
    /** Default Claude model. null = CLI default. */
    model: ClaudeModel | null;
    /** Claude CLI --effort level. null = CLI default. */
    effort: ClaudeEffort | null;
    /** Restrict Claude to these tools. null = no restriction. */
    allowedTools: string[] | null;
  };

  /** External tools that can open a workspace path (editor, terminal, etc.). */
  openers: Opener[];
}

/**
 * A user-defined external tool (editor, terminal, browser, ...) that can be
 * launched to open a workspace or repository path.
 *
 * Names must be unique across `openers`. The `command` must contain the
 * `{path}` placeholder which is replaced with the target absolute path.
 */
export interface Opener {
  /** Unique display name. Shown in the "Open in..." menu. */
  name: string;
  /** Shell command. `{path}` is replaced with the target path. */
  command: string;
}
