import type { AskQuestion } from "./claude";
import type { WorkspaceRepo } from "./workspace";

export interface GroupChild {
  label: string;
  prompt: string;
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Additional directories to expose via --add-dir. */
  addDirs?: string[];
  /** JSON Schema for structured output via --json-schema. */
  jsonSchema?: Record<string, unknown>;
  /** Called with the model's final text response when the child process completes. */
  onResultText?: (text: string) => void;
  /** When true, skip AskUserQuestion instead of waiting for user input. */
  skipAskUserQuestion?: boolean;
}

export interface PipelinePhaseSingle {
  kind: "single";
  label: string;
  prompt: string;
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Additional directories to expose via --add-dir. */
  addDirs?: string[];
  timeoutMs?: number;
}

export interface PipelinePhaseGroup {
  kind: "group";
  children: GroupChild[];
  timeoutMs?: number;
}

export interface RunChildOptions {
  /** JSON Schema for structured output via --json-schema. */
  jsonSchema?: Record<string, unknown>;
  /** Called with the model's final text response when the child process completes. */
  onResultText?: (text: string) => void;
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Additional directories to expose via --add-dir. */
  addDirs?: string[];
  /** When true, skip AskUserQuestion instead of waiting for user input. */
  skipAskUserQuestion?: boolean;
}

export interface PhaseFunctionContext {
  operationId: string;
  emitStatus: (message: string) => void;
  /** Emit a result message that will be displayed outside the collapsible log. */
  emitResult: (message: string) => void;
  /** Ask the user a question and wait for their answer. Returns the answers keyed by question text. */
  emitAsk: (questions: AskQuestion[], options?: { allowFreeText?: boolean }) => Promise<Record<string, string>>;
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
  timeoutMs?: number;
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
  /** When set, wraps the pipeline in Best-of-N mode with N parallel candidates. */
  bestOfN?: number;
}

export interface SetupRepositoryResult extends WorkspaceRepo {
  baseBranch: string;
  branchName: string;
}
