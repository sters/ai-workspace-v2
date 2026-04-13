import type { ClaudeModel } from "./claude";
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
  };

  /** Editor launch command. Use `{path}` as placeholder for the target path. */
  editor: string;

  /** Terminal launch command. Use `{path}` as placeholder for the target path. */
  terminal: string;
}
