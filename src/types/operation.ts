export type OperationType =
  | "init"
  | "execute"
  | "review"
  | "create-pr"
  | "update-todo"
  | "create-todo"
  | "delete"
  | "workspace-prune"
  | "operation-prune"
  | "mcp-auth"
  | "claude-login"
  | "batch"
  | "autonomous"
  | "search";

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
  /** User-provided inputs when the operation was started (e.g. instruction, description). */
  inputs?: Record<string, string>;
}

/** Lightweight summary for listing operations (no children/full phases). */
export interface OperationListItem {
  id: string;
  type: OperationType;
  workspace: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  /** Only the currently-running phase (if any), for display in lists. */
  currentPhase?: Pick<OperationPhaseInfo, "index" | "label" | "status" | "timeoutMs" | "startedAt">;
  /** User-provided inputs (present when created locally via POST, absent from list API). */
  inputs?: Record<string, string>;
  /** Last result text from the operation (populated for completed/failed operations). */
  resultSummary?: { content: string; cost?: string; duration?: string };
  /** True when the operation is waiting for user input (AskUserQuestion). */
  hasPendingAsk?: boolean;
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

