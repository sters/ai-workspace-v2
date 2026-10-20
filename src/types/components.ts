import type { OperationType, OperationEvent, OperationListItem } from "./operation";

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

export type CardVariant = "default" | "flush" | "dashed";

export type CalloutVariant = "info" | "warning" | "error";

export interface NextAction {
  label: string;
  type: OperationType;
  body: Record<string, string>;
  primary?: boolean;
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
  defaultExpanded?: boolean;
  /**
   * When set, a finished operation shows a "View" link to this href instead of
   * the inline "Retry" button (used in cross-workspace history lists).
   */
  viewHref?: string;
}

export interface McpAuthTerminalProps {
  events: OperationEvent[];
  isRunning: boolean;
  operationStatus?: "running" | "completed" | "failed";
}
