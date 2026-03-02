export type OperationType =
  | "init"
  | "execute"
  | "review"
  | "create-pr"
  | "update-todo"
  | "create-todo"
  | "delete"
  | "workspace-prune"
  | "mcp-auth"
  | "claude-login"
  | "batch";

export type OperationStatus = "running" | "completed" | "failed";

export interface OperationChild {
  id: string;
  label: string;
  status: OperationStatus;
}

export interface OperationPhaseInfo {
  index: number;
  label: string;
  status: OperationStatus | "pending" | "skipped";
  /** Timeout in milliseconds for this phase. */
  timeoutMs?: number;
  /** ISO timestamp when this phase started running. */
  startedAt?: string;
}

export interface Operation {
  id: string;
  type: OperationType;
  workspace: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  children?: OperationChild[];
  phases?: OperationPhaseInfo[];
}

export interface OperationEvent {
  type: "output" | "error" | "complete" | "status" | "terminal";
  operationId: string;
  data: string;
  timestamp: string;
  /** Which child operation this event belongs to (for operation groups). */
  childLabel?: string;
  /** Pipeline phase index (0-based) this event belongs to. */
  phaseIndex?: number;
  /** Pipeline phase label this event belongs to. */
  phaseLabel?: string;
}

export interface SetupWorkspaceResult {
  workspaceName: string;
  workspacePath: string;
}

export interface OperationContext {
  /** Start a new operation. Handles loading state internally. */
  start: (
    type: OperationType,
    body: Record<string, string>
  ) => Promise<void>;
  /** True while an operation is running (or starting). */
  isRunning: boolean;
  /** True when there is an active or completed operation. */
  hasOperation: boolean;
  /** The workspace name (may be updated dynamically during the operation). */
  workspace?: string;
  /** The operation status. */
  status?: string;
}

