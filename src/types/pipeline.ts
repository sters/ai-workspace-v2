export interface GroupChild {
  label: string;
  prompt: string;
}

export interface PipelinePhaseSingle {
  kind: "single";
  label: string;
  prompt: string;
}

export interface PipelinePhaseGroup {
  kind: "group";
  children: GroupChild[];
}

export interface AskQuestionOption {
  label: string;
  description: string;
}

export interface AskQuestionDef {
  question: string;
  options: AskQuestionOption[];
  multiSelect?: boolean;
}

export interface RunChildOptions {
  /** JSON Schema for structured output via --json-schema. */
  jsonSchema?: Record<string, unknown>;
  /** Called with the model's final text response when the child process completes. */
  onResultText?: (text: string) => void;
}

export interface PhaseFunctionContext {
  operationId: string;
  emitStatus: (message: string) => void;
  /** Emit a result message that will be displayed outside the collapsible log. */
  emitResult: (message: string) => void;
  /** Ask the user a question and wait for their answer. Returns the answers keyed by question text. */
  emitAsk: (questions: AskQuestionDef[]) => Promise<Record<string, string>>;
  /** Update the operation's workspace identifier. Notifies the FE via a special event. */
  setWorkspace: (workspace: string) => void;
  /** Run a single Claude child query and wait for completion. */
  runChild: (label: string, prompt: string, options?: RunChildOptions) => Promise<boolean>;
  /** Run multiple Claude child queries in parallel and wait for all to complete. */
  runChildGroup: (children: GroupChild[]) => Promise<boolean[]>;
  /** Emit raw terminal (PTY) output for xterm.js rendering on the client. */
  emitTerminal: (data: string) => void;
  /** Abort signal that fires when the operation is killed. Use to clean up external processes. */
  signal: AbortSignal;
}

export interface PipelinePhaseFunction {
  kind: "function";
  label: string;
  fn: (ctx: PhaseFunctionContext) => Promise<boolean>;
}

export type PipelinePhase =
  | PipelinePhaseSingle
  | PipelinePhaseGroup
  | PipelinePhaseFunction;

export interface PipelineOptions {
  onPhaseComplete?: (
    phaseIndex: number,
    phase: PipelinePhase,
    success: boolean,
  ) => "continue" | "skip" | "abort";
}
