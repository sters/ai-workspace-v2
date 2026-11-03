import { getDb } from "./connection";
import type { BenchAttempt } from "@/lib/bench/summary";

export interface BenchRun {
  operationId: string;
  workspace: string;
  step: string;
  repo: string | null;
  /** The `<model>/<effort>` the others are scored against. */
  reference: string;
  attempts: BenchAttempt[];
  createdAt: string;
}

interface BenchRunRow {
  operation_id: string;
  workspace: string;
  step: string;
  repo: string | null;
  reference: string;
  attempts_json: string;
  created_at: string;
}

const toDomain = (r: BenchRunRow): BenchRun => ({
  operationId: r.operation_id,
  workspace: r.workspace,
  step: r.step,
  repo: r.repo,
  reference: r.reference,
  attempts: JSON.parse(r.attempts_json) as BenchAttempt[],
  createdAt: r.created_at,
});

export function insertBenchRun(run: Omit<BenchRun, "createdAt">): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO bench_runs (operation_id, workspace, step, repo, reference, attempts_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(run.operationId, run.workspace, run.step, run.repo, run.reference, JSON.stringify(run.attempts));
}

export function listBenchRuns(limit: number): BenchRun[] {
  return (getDb().prepare("SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT ?").all(limit) as BenchRunRow[]).map(toDomain);
}
