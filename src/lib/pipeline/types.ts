import type { ClaudeProcess } from "@/types/claude";
import type { OperationEvent, Operation, OperationResultSummary } from "@/types/operation";

export interface ChildProcessEntry {
  process: ClaudeProcess;
  childLabel?: string;
  phaseIndex?: number;
  phaseLabel?: string;
}

export interface ManagedOperation {
  operation: Operation;
  claudeProcess: ClaudeProcess | null;
  childProcesses: Map<string, ChildProcessEntry>;
  events: OperationEvent[];
  listeners: Set<(event: OperationEvent) => void>;
  /** Pending ask resolvers for function-phase emitAsk calls, keyed by toolUseId. */
  pendingAsks: Map<string, (answers: Record<string, string>) => void>;
  /** True when the operation is waiting for user input (AskUserQuestion). */
  hasPendingAsk: boolean;
  /** Abort controller for cancelling function-phase work (e.g. PTY processes). */
  abortController: AbortController;
  /** Timestamp (ms) when the operation completed. Used for GC. */
  completedAt?: number;
  /**
   * The operation's results, computed when it completed. `events` is cleared at
   * that point, so this is the only in-memory source for the listing.
   */
  resultSummary?: OperationResultSummary;
}

export interface WireChildResult {
  success: boolean;
  resultText?: string;
}
