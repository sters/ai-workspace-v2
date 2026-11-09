/**
 * A verification scenario: the steps that check a workspace's change actually
 * works when run, in the order they are carried out. Claude steps are shell
 * commands run unattended; human steps stop the run until someone answers them.
 * Stored as `artifacts/verification/<id>.json`.
 */

export type VerificationActor = "claude" | "human";

export type VerificationStepStatus = "pending" | "running" | "waiting" | "passed" | "failed" | "skipped";

/**
 * - `ready`: nothing is running; the next pending step runs on `run`.
 * - `waiting`: stopped on a human step.
 * - `failed`: stopped on a failed command, a human NG, or an interrupted run —
 *   background processes are left up so the failure can be looked at.
 * - `passed` / `aborted`: finished, teardown done.
 */
export type VerificationScenarioStatus = "ready" | "running" | "waiting" | "failed" | "passed" | "aborted";

/** A value a human step asks for. With `options` it is a choice, otherwise free text. */
export interface VerificationInput {
  name: string;
  label: string;
  options?: string[];
}

/** A step as the planner (or the editor) writes it, before it has run. */
export interface VerificationStepDraft {
  title: string;
  actor: VerificationActor;
  /** Worktree directory name the command runs in; the workspace directory when unset. */
  repo?: string;
  /** Claude steps: run with `sh -c`. `{{name}}` expands to a shell-quoted variable. */
  command?: string;
  /** Claude steps: the command keeps running (a dev server); it is stopped at teardown. */
  background?: boolean;
  /** Background steps: polled until it exits 0, which is when the step passes. */
  readyCommand?: string;
  /**
   * Claude steps: variables taken from the command's stdout — the keys of a JSON
   * object it prints, or, for a single name, the whole trimmed stdout.
   */
  outputs?: string[];
  /** Human steps: what to do, Markdown. `{{name}}` expands to the variable. */
  instructions?: string;
  inputs?: VerificationInput[];
  expected?: string;
  /** Acceptance criteria this step's pass satisfies, quoted from the README. */
  criteria?: string[];
  /** Runs when the scenario ends, however it ends. */
  teardown?: boolean;
}

export interface VerificationStepResult {
  at: string;
  exitCode?: number | null;
  /** Tail of the command's output. */
  output?: string;
  durationMs?: number;
  /** The human's note, or why the step failed without running. */
  note?: string;
  values?: Record<string, string>;
}

export interface VerificationStep extends VerificationStepDraft {
  id: string;
  status: VerificationStepStatus;
  /** Which plan wrote this step: 0 for the first draft, incremented by each replan. */
  revision: number;
  result?: VerificationStepResult;
}

export interface VerificationProcess {
  stepId: string;
  pid: number;
  command: string;
  logFile: string;
  startedAt: string;
}

export interface VerificationScenario {
  id: string;
  title: string;
  summary: string;
  status: VerificationScenarioStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  variables: Record<string, string>;
  steps: VerificationStep[];
  /** Background processes still running for this scenario. */
  processes: VerificationProcess[];
}
