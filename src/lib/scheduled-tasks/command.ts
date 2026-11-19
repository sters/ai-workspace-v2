import { recordCommandResult, updateScheduledTaskState } from "@/lib/db/scheduled-tasks";
import { runProcess } from "@/lib/process/run";
import type { ScheduledTask } from "@/types/scheduled-task";
import type { SchedulerDeps } from "./scheduler";

/**
 * Runs `command` tasks as `sh -c <prompt>` in the worker. `start` returns once
 * the command is spawned; its exit code and output are recorded on the task
 * when it finishes.
 */
export function createCommandRunner(opts: { cwd: string; env: Record<string, string | undefined> }): SchedulerDeps {
  const running = new Map<number, number>();
  const add = (id: number, n: number) => running.set(id, (running.get(id) ?? 0) + n);

  return {
    isRunning: (task) => (running.get(task.id) ?? 0) > 0,
    start: async (task: ScheduledTask) => {
      updateScheduledTaskState(task.id, { lastRunAt: new Date().toISOString() });
      add(task.id, 1);
      void runProcess(["sh", "-c", task.prompt], opts)
        .then((r) => recordCommandResult(task.id, r.exitCode, r.stdout + r.stderr))
        .catch((err: unknown) => recordCommandResult(task.id, -1, String(err)))
        .finally(() => add(task.id, -1));
    },
  };
}
