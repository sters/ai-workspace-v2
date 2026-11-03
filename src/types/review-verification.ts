/** What the completion verifier returns for one repository: README requirements and TODO items, checked against the code. */

export type CriterionKind = "auto" | "manual";

export type CriterionStatus = "SATISFIED" | "PARTIAL" | "UNSATISFIED" | "PENDING-HUMAN";

export type TodoItemStatus = "VERIFIED" | "UNVERIFIED" | "PARTIAL" | "INCOMPLETE" | "UNMARKED" | "SKIPPED";

export interface RequirementCheck {
  requirement: string;
  kind: CriterionKind;
  status: CriterionStatus;
  evidence: string;
  notes?: string;
}

export interface TodoItemCheck {
  item: string;
  status: TodoItemStatus;
  evidence: string;
}

export interface CompletionVerification {
  requirements: RequirementCheck[];
  /** Empty when the repository has no TODO file. */
  todoItems: TodoItemCheck[];
  recommendations: string[];
}
