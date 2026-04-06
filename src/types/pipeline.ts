import type { AskQuestion, ClaudeModel } from "./claude";
import type { WorkspaceRepo } from "./workspace";

/** All known step type identifiers for config-based model resolution. */
export const STEP_TYPES = {
  CODE_REVIEW: "code-review",
  VERIFY_TODO: "verify-todo",
  VERIFY_README: "verify-readme",
  COLLECT_REVIEWS: "collect-reviews",
  EXECUTE: "execute",
  RESEARCH: "research",
  ANALYZE_README: "analyze-readme",
  DISCOVER_CONSTRAINTS: "discover-constraints",
  PLAN_TODO: "plan-todo",
  COORDINATE_TODOS: "coordinate-todos",
  REVIEW_TODOS: "review-todos",
  CREATE_PR: "create-pr",
  UPDATE_TODO: "update-todo",
  PLAN_TODO_FROM_REVIEW: "plan-todo-from-review",
  DEEP_SEARCH: "deep-search",
  AUTONOMOUS_GATE: "autonomous-gate",
  BEST_OF_N_REVIEWER: "best-of-n-reviewer",
  BEST_OF_N_SYNTHESIZER: "best-of-n-synthesizer",
  AGGREGATE_SUGGESTIONS: "aggregate-suggestions",
  PRUNE_SUGGESTIONS: "prune-suggestions",
} as const;

export type StepType = (typeof STEP_TYPES)[keyof typeof STEP_TYPES];

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
  /** Claude model override for this child. */
  model?: ClaudeModel;
  /** Step type identifier for config-based model resolution. */
  stepType?: StepType;
  /** Path to a file whose content is appended to Claude's system prompt via --append-system-prompt-file. */
  appendSystemPromptFile?: string;
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
  /** Maximum number of retry attempts on failure (default: 2). Set to 0 to disable. */
  maxRetries?: number;
  /** Delay in ms between retry attempts (default: 3000). */
  retryDelayMs?: number;
  /** Claude model override for this phase. */
  model?: ClaudeModel;
  /** Step type identifier for config-based model resolution. */
  stepType?: StepType;
  /** Path to a file whose content is appended to Claude's system prompt via --append-system-prompt-file. */
  appendSystemPromptFile?: string;
}

export interface PipelinePhaseGroup {
  kind: "group";
  children: GroupChild[];
  timeoutMs?: number;
  /** Maximum number of retry attempts on failure (default: 2). Set to 0 to disable. */
  maxRetries?: number;
  /** Delay in ms between retry attempts (default: 3000). */
  retryDelayMs?: number;
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
  /** Claude model override for this child. */
  model?: ClaudeModel;
  /** Step type identifier for config-based model resolution. */
  stepType?: StepType;
  /** Path to a file whose content is appended to Claude's system prompt via --append-system-prompt-file. */
  appendSystemPromptFile?: string;
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
  /** Maximum number of retry attempts on failure (default: 2). Set to 0 to disable. */
  maxRetries?: number;
  /** Delay in ms between retry attempts (default: 3000). */
  retryDelayMs?: number;
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
