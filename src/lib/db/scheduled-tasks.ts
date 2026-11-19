import { getDb } from "./connection";
import type { ScheduledTask, ScheduledTaskInput, ScheduledTaskKind, ScheduledTaskOverlap } from "@/types/scheduled-task";

interface ScheduledTaskRow {
  id: number;
  title: string;
  request: string;
  kind: string;
  prompt: string;
  cron: string;
  overlap: string;
  enabled: number;
  builtin: string | null;
  last_exit_code: number | null;
  last_output: string | null;
  next_run_at: string | null;
  queued: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomain(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    request: row.request,
    kind: row.kind as ScheduledTaskKind,
    prompt: row.prompt,
    cron: row.cron,
    overlap: row.overlap as ScheduledTaskOverlap,
    enabled: row.enabled === 1,
    builtin: row.builtin,
    nextRunAt: row.next_run_at,
    queued: row.queued === 1,
    lastRunAt: row.last_run_at,
    lastExitCode: row.last_exit_code,
    lastOutput: row.last_output,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The first occurrence of `cron` after `from`. Throws on an invalid expression or one that never comes due. */
export function nextOccurrence(cron: string, from: Date): string {
  const next = Bun.cron.parse(cron, from);
  if (!next) throw new Error(`cron "${cron}" never comes due`);
  return next.toISOString();
}

function params(input: ScheduledTaskInput, now: Date) {
  return {
    $title: input.title,
    $request: input.request,
    $prompt: input.prompt,
    $cron: input.cron,
    $overlap: input.overlap,
    $enabled: input.enabled ? 1 : 0,
    $nextRunAt: input.enabled ? nextOccurrence(input.cron, now) : null,
  };
}

export function getScheduledTask(id: number): ScheduledTask | null {
  const row = getDb().query("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as ScheduledTaskRow | null;
  return row ? rowToDomain(row) : null;
}

export function listScheduledTasks(): ScheduledTask[] {
  return (getDb().query("SELECT * FROM scheduled_tasks ORDER BY id ASC").all() as ScheduledTaskRow[]).map(rowToDomain);
}

export function insertScheduledTask(input: ScheduledTaskInput, now = new Date(), builtin: string | null = null): ScheduledTask {
  const result = getDb()
    .query(`
      INSERT INTO scheduled_tasks (title, request, kind, prompt, cron, overlap, enabled, next_run_at, builtin)
      VALUES ($title, $request, $kind, $prompt, $cron, $overlap, $enabled, $nextRunAt, $builtin)
    `)
    .run({ ...params(input, now), $kind: input.kind, $builtin: builtin });
  return getScheduledTask(Number(result.lastInsertRowid))!;
}

/** Registers aiw's own task under `builtin` the first time; afterwards returns it as people left it. */
export function ensureBuiltinScheduledTask(builtin: string, input: ScheduledTaskInput, now = new Date()): ScheduledTask {
  const row = getDb().query("SELECT * FROM scheduled_tasks WHERE builtin = ?").get(builtin) as ScheduledTaskRow | null;
  return row ? rowToDomain(row) : insertScheduledTask(input, now, builtin);
}

/** Replaces the task's settings and reschedules it from `now`; disabling drops a queued run. */
export function updateScheduledTask(id: number, input: ScheduledTaskInput, now = new Date()): ScheduledTask | null {
  const result = getDb()
    .query(`
      UPDATE scheduled_tasks
      SET title = $title, request = $request, prompt = $prompt, cron = $cron, overlap = $overlap,
          enabled = $enabled, next_run_at = $nextRunAt, queued = queued * $enabled,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = $id
    `)
    .run({ ...params(input, now), $id: id });
  return result.changes > 0 ? getScheduledTask(id) : null;
}

/** Deletes a task people created; a built-in one is kept and reports false. */
export function deleteScheduledTask(id: number): boolean {
  return getDb().query("DELETE FROM scheduled_tasks WHERE id = ? AND builtin IS NULL").run(id).changes > 0;
}

const OUTPUT_TAIL_CHARS = 4000;

export function recordCommandResult(id: number, exitCode: number, output: string): void {
  getDb()
    .query("UPDATE scheduled_tasks SET last_exit_code = ?, last_output = ? WHERE id = ?")
    .run(exitCode, output.slice(-OUTPUT_TAIL_CHARS), id);
}

/** Records the scheduler's decision for one task; omitted fields keep their value. */
export function updateScheduledTaskState(
  id: number,
  state: { nextRunAt?: string; queued?: boolean; lastRunAt?: string },
): void {
  getDb()
    .query(`
      UPDATE scheduled_tasks
      SET next_run_at = COALESCE($nextRunAt, next_run_at),
          queued = COALESCE($queued, queued),
          last_run_at = COALESCE($lastRunAt, last_run_at)
      WHERE id = $id
    `)
    .run({
      $id: id,
      $nextRunAt: state.nextRunAt ?? null,
      $queued: state.queued === undefined ? null : state.queued ? 1 : 0,
      $lastRunAt: state.lastRunAt ?? null,
    });
}
