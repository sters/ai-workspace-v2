/**
 * What a due occurrence does while the task's previous run is still going:
 * `skip` drops it, `parallel` starts another run beside it, `queue` runs once
 * the previous run finishes (any number of occurrences coalesce into one).
 */
export const SCHEDULED_TASK_OVERLAPS = ["skip", "parallel", "queue"] as const;
export type ScheduledTaskOverlap = (typeof SCHEDULED_TASK_OVERLAPS)[number];

/** `prompt` runs `prompt` as an instruction for an agent; `command` runs it as a shell command in the worker. */
export const SCHEDULED_TASK_KINDS = ["prompt", "command"] as const;
export type ScheduledTaskKind = (typeof SCHEDULED_TASK_KINDS)[number];

export interface ScheduledTask {
  id: number;
  title: string;
  /** The request as the person wrote it, before planning. */
  request: string;
  kind: ScheduledTaskKind;
  /** The instruction the unattended agent runs, or the shell command for `command`. */
  prompt: string;
  /** Five-field cron expression, in the server's local time. */
  cron: string;
  overlap: ScheduledTaskOverlap;
  enabled: boolean;
  /** Set on a task aiw itself registers; such a task cannot be deleted. */
  builtin: string | null;
  /** ISO time of the next occurrence; null while disabled. */
  nextRunAt: string | null;
  /** An occurrence is waiting for the running one to finish (`queue`). */
  queued: boolean;
  lastRunAt: string | null;
  /** `command` only: the last finished run's exit code and the tail of its output. */
  lastExitCode: number | null;
  lastOutput: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskInput {
  title: string;
  request: string;
  /** Fixed at creation; an edit keeps the stored kind. */
  kind: ScheduledTaskKind;
  prompt: string;
  cron: string;
  overlap: ScheduledTaskOverlap;
  enabled: boolean;
}
