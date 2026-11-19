import type { ScheduledTask } from "@/types/scheduled-task";
import type { SchedulerDeps } from "./scheduler";

const RUN_LABEL = /^scheduled-task-(\d+)$/;

/**
 * Scheduler dependencies for the worker process. Operations live in the Next
 * server's memory, so the worker asks it which tasks are running (once per
 * tick) and has it start runs.
 */
export async function createServerDeps(baseUrl: string): Promise<SchedulerDeps> {
  const res = await fetch(`${baseUrl}/api/operations?status=running`);
  if (!res.ok) throw new Error(`listing running operations failed: HTTP ${res.status}`);
  const running = new Set<number>();
  for (const op of (await res.json()) as { workspace?: string }[]) {
    const m = op.workspace?.match(RUN_LABEL);
    if (m) running.add(Number(m[1]));
  }

  return {
    isRunning: (taskId) => running.has(taskId),
    start: async (task: ScheduledTask) => {
      const r = await fetch(`${baseUrl}/api/scheduled-tasks/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
    },
  };
}
