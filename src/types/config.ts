import type { OperationType } from "./operation";
import type { InteractionLevel } from "./prompts";

/** Settings that can be overridden per operation type. */
export interface OperationTypeSettings {
  claudeTimeoutMinutes: number;
  functionTimeoutMinutes: number;
  defaultInteractionLevel: InteractionLevel;
  /** Best-of-N parallel execution count. 0 = disabled, 2-5 = parallel count. */
  bestOfN: number;
}

export interface AppConfig {
  workspaceRoot: string | null;

  server: {
    port: number;
    chatPort: number;
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

  /** Editor launch command. Use `{path}` as placeholder for the target path. */
  editor: string;

  /** Terminal launch command. Use `{path}` as placeholder for the target path. */
  terminal: string;
}
