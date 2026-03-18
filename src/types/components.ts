import type { OperationType, OperationEvent, OperationListItem } from "./operation";

// ---------------------------------------------------------------------------
// Shared: Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "destructive-sm"
  | "outline"
  | "outline-muted"
  | "ghost"
  | "ghost-toggle";

export interface SplitButtonItem {
  label: string;
  onClick: () => void | Promise<unknown>;
}

export type SplitButtonVariant = "primary" | "secondary" | "outline";

// ---------------------------------------------------------------------------
// Shared: Containers
// ---------------------------------------------------------------------------

export type CardVariant = "default" | "flush" | "dashed";

export type CalloutVariant = "info" | "warning" | "error";

// ---------------------------------------------------------------------------
// Operation components
// ---------------------------------------------------------------------------

export interface NextAction {
  label: string;
  type: OperationType;
  body: Record<string, string>;
  primary?: boolean;
  /** Batch dropdown items for this action. */
  batchItems?: { label: string; type: OperationType; body: Record<string, string> }[];
  /** When set, renders as a link navigating to this sub-path (e.g. "/review") instead of triggering an operation. */
  linkSubPath?: string;
}

export interface OperationLogProps {
  operationId: string;
  events: OperationEvent[];
  isRunning: boolean;
}

export interface OperationCardProps {
  operation: OperationListItem;
  /** Called when user starts a new operation from next-action suggestions. */
  onStartOperation: (type: OperationType, body: Record<string, string>) => Promise<void>;
  /** Called when user clicks Cancel on a running operation. */
  onCancel: (operationId: string) => void;
  /** Whether this card should be expanded by default. */
  defaultExpanded?: boolean;
}

export interface McpAuthTerminalProps {
  events: OperationEvent[];
  isRunning: boolean;
  operationStatus?: "running" | "completed" | "failed";
}
