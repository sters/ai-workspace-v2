import type { getConfig } from "@/lib/config";
import { listWorkerJobRuns } from "@/lib/db/worker-jobs";
import type { BuiltinWorkerJob } from "@/types/worker-job";

export const WORKER_JOBS = {
  PR_WATCHER: "pr-watcher",
  SCHEDULED_TASKS: "scheduled-tasks",
} as const;

const NEVER_RUN = { lastStartedAt: null, lastFinishedAt: null, lastError: null };

/**
 * The worker's jobs in the order it starts them, each with what it last
 * recorded. The scheduled-task tick is left out: it is what runs the listed
 * tasks, not one of them.
 */
export function listBuiltinWorkerJobs(cfg: ReturnType<typeof getConfig>): BuiltinWorkerJob[] {
  const runs = listWorkerJobRuns();
  const jobs: Omit<BuiltinWorkerJob, keyof typeof NEVER_RUN>[] = [
    {
      name: WORKER_JOBS.PR_WATCHER,
      title: "PR watcher",
      description: "Records new comments, pushes, CI and merge state of each workspace's pull requests (gh only, no LLM).",
      schedule: `Every minute for notified / changed PRs; every ${cfg.watcher.intervalMinutes} min for all`,
      enabled: cfg.watcher.enabled,
      toggle: "watcher.enabled in AIW Settings (takes effect on restart)",
    },
  ];
  return jobs.map((job) => ({ ...job, ...(runs.get(job.name) ?? NEVER_RUN) }));
}
