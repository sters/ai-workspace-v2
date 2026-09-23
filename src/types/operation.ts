export type OperationType =
  | "init"
  | "init-from-pr"
  | "execute"
  | "review"
  | "create-pr"
  | "update-todo"
  | "update-readme"
  | "validate-pr-comments"
  | "post-review-findings"
  | "resolve-base-conflicts"
  | "create-todo"
  | "delete"
  | "workspace-prune"
  | "operation-prune"
  | "mcp-auth"
  | "claude-login"
  | "batch"
  | "autonomous"
  | "search"
  | "discovery"
  | "aggregate-suggestions"
  | "prune-suggestions";

export type OperationStatus = "running" | "completed" | "failed";

export interface OperationChild {
  id: string;
  label: string;
  status: OperationStatus;
}

export interface OperationPhaseInfo {
  index: number;
  label: string;
  status: OperationStatus | "pending" | "skipped" | "retrying";
  /** Timeout in milliseconds for this phase. */
  timeoutMs?: number;
  /** ISO timestamp when this phase started running. */
  startedAt?: string;
  /** Maximum number of retries configured for this phase. */
  maxRetries?: number;
  /** Current retry attempt (0 = first run, 1 = first retry, etc.). */
  retryAttempt?: number;
}

/** One child's final message, as the agent wrote it. */
export interface OperationResult {
  /** The child that produced it — a repository name for a per-repo fan-out. */
  label?: string;
  content: string;
  cost?: string;
  duration?: string;
}

export interface OperationResultSummary {
  /** The last result of the run. */
  content: string;
  cost?: string;
  duration?: string;
  /**
   * Every result of the phase that produced it, present only when that phase
   * had more than one child. A per-repo fan-out writes one result per
   * repository and `content` alone is whichever finished last.
   */
  results?: OperationResult[];
}

export interface Operation {
  id: string;
  type: OperationType;
  workspace: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  // TODO: Make required (`children: OperationChild[]`) once db/operations.ts
  // and db/migrate-jsonl.ts always provide a default `[]`.
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
  /** Result text from the operation (populated for completed/failed operations). */
  resultSummary?: OperationResultSummary;
  /** True when the operation is waiting for user input (AskUserQuestion). */
  hasPendingAsk?: boolean;
}

/**
 * A workspace whose latest operation stopped because the account's Claude
 * allowance ran out — the run is unfinished and no retry will get past it until
 * the allowance resets.
 */
export interface UsageLimitStop {
  workspace: string;
  /** The operation that died, so the UI can link straight to its log. */
  operationId: string;
  /** The CLI's own wording, e.g. "You've hit your session limit · resets 9:40pm (Asia/Tokyo)". */
  message: string;
  /** When it gave up. */
  at?: string;
}

export interface OperationEvent {
  type: "output" | "error" | "complete" | "status" | "terminal";
  operationId: string;
  data: string;
  timestamp: string;
  /** Which child operation this event belongs to (for operation groups). */
  childLabel?: string;
  /** Parent child-group label, when this event was emitted from a child process
   * spawned inside a function phase whose own emissions use a different
   * childLabel. Lets the UI nest the child group under its parent. */
  parentChildLabel?: string;
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
  /** Clear the current operation (in-memory state + localStorage persistence). */
  reset: () => void;
  /** True while an operation is running (or starting). */
  isRunning: boolean;
  /** True when there is an active or completed operation. */
  hasOperation: boolean;
  /** The workspace name (may be updated dynamically during the operation). */
  workspace?: string;
  /** The operation status. */
  status?: OperationStatus;
}

