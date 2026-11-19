/** What the worker last recorded for one of its jobs. */
export interface WorkerJobRun {
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  /** The last finished tick's error; null once a tick succeeds. */
  lastError: string | null;
}

/** A job built into the worker (`bin/worker.ts`), listed beside the scheduled tasks. */
export interface BuiltinWorkerJob extends WorkerJobRun {
  name: string;
  title: string;
  description: string;
  schedule: string;
  enabled: boolean;
  /** Where to turn it on or off, when it can be. */
  toggle: string | null;
}
