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
    isRunning: (task) => running.has(task.id),
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

/**
 * The worker's scheduler dependencies: `command` tasks go to `commands`, which
 * runs them in the worker; `prompt` tasks to the web server, asked only on a
 * tick where one is due. An unreachable server fails only the prompt tasks'
 * starts, which leaves them due.
 */
function unreachable(err: unknown): SchedulerDeps {
  return {
    isRunning: () => false,
    start: async () => {
      throw err;
    },
  };
}

export function createWorkerDeps(baseUrl: string, commands: SchedulerDeps) {
  return async (candidates: ScheduledTask[]): Promise<SchedulerDeps> => {
    const server = candidates.some((t) => t.kind === "prompt") ? await createServerDeps(baseUrl).catch(unreachable) : null;
    const pick = (task: ScheduledTask) => (task.kind === "command" ? commands : server!);
    return {
      isRunning: (task) => pick(task).isRunning(task),
      start: (task) => pick(task).start(task),
    };
  };
}
