import type { OperationEvent } from "./operation";

export interface ClaudeProcess {
  id: string;
  onEvent: (handler: (event: OperationEvent) => void) => void;
  kill: () => void;
  submitAnswer: (toolUseId: string, answers: Record<string, string>) => boolean;
  /** Returns the model's final text response (captured from the result event). */
  getResultText: () => string | undefined;
}
