import { getDb } from "./connection";
import type { WorkerJobRun } from "@/types/worker-job";

export function recordWorkerJobStart(name: string, at: string): void {
  getDb()
    .query(`
      INSERT INTO worker_jobs (name, last_started_at) VALUES ($name, $at)
      ON CONFLICT(name) DO UPDATE SET last_started_at = $at
    `)
    .run({ $name: name, $at: at });
}

export function recordWorkerJobFinish(name: string, at: string, error: string | null): void {
  getDb()
    .query(`
      INSERT INTO worker_jobs (name, last_finished_at, last_error) VALUES ($name, $at, $error)
      ON CONFLICT(name) DO UPDATE SET last_finished_at = $at, last_error = $error
    `)
    .run({ $name: name, $at: at, $error: error });
}

export function listWorkerJobRuns(): Map<string, WorkerJobRun> {
  const rows = getDb().query("SELECT * FROM worker_jobs").all() as {
    name: string;
    last_started_at: string | null;
    last_finished_at: string | null;
    last_error: string | null;
  }[];
  return new Map(
    rows.map((r) => [r.name, { lastStartedAt: r.last_started_at, lastFinishedAt: r.last_finished_at, lastError: r.last_error }]),
  );
}
