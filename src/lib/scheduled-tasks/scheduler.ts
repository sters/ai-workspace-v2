import { listScheduledTasks, nextOccurrence, updateScheduledTaskState } from "@/lib/db/scheduled-tasks";
import type { ScheduledTask } from "@/types/scheduled-task";

export interface SchedulerDeps {
  isRunning: (taskId: number) => boolean;
  /** Starts a run; rejects when it cannot (server down, concurrency limit), which leaves the occurrence due. */
  start: (task: ScheduledTask) => Promise<void>;
}

async function tryStart(task: ScheduledTask, deps: SchedulerDeps): Promise<boolean> {
  try {
    await deps.start(task);
    return true;
  } catch (err) {
    console.warn(`[scheduled-tasks] could not start #${task.id} "${task.title}": ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Starts every enabled task that is due at `now`. An occurrence missed while
 * the server was down is still due, so it runs once on the first tick after,
 * and the next occurrence is counted from `now`, never from the missed one.
 */
export async function tickScheduledTasks(now: Date, deps: SchedulerDeps): Promise<void> {
  for (const task of listScheduledTasks()) {
    if (!task.enabled || !task.nextRunAt) continue;
    const running = deps.isRunning(task.id);
    const due = now >= new Date(task.nextRunAt);
    if (!due && !(task.queued && !running)) continue;

    const advance = due ? { nextRunAt: nextOccurrence(task.cron, now) } : {};
    if (!running || task.overlap === "parallel") {
      if (await tryStart(task, deps)) updateScheduledTaskState(task.id, { ...advance, queued: false });
    } else {
      updateScheduledTaskState(task.id, { ...advance, queued: task.queued || task.overlap === "queue" });
    }
  }
}
