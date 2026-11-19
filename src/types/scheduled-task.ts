/**
 * What a due occurrence does while the task's previous run is still going:
 * `skip` drops it, `parallel` starts another run beside it, `queue` runs once
 * the previous run finishes (any number of occurrences coalesce into one).
 */
export const SCHEDULED_TASK_OVERLAPS = ["skip", "parallel", "queue"] as const;
export type ScheduledTaskOverlap = (typeof SCHEDULED_TASK_OVERLAPS)[number];

export interface ScheduledTask {
  id: number;
  title: string;
  /** The request as the person wrote it, before planning. */
  request: string;
  /** The instruction the unattended agent runs. */
  prompt: string;
  /** Five-field cron expression, in the server's local time. */
  cron: string;
  overlap: ScheduledTaskOverlap;
  enabled: boolean;
  /** ISO time of the next occurrence; null while disabled. */
  nextRunAt: string | null;
  /** An occurrence is waiting for the running one to finish (`queue`). */
  queued: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskInput {
  title: string;
  request: string;
  prompt: string;
  cron: string;
  overlap: ScheduledTaskOverlap;
  enabled: boolean;
}
