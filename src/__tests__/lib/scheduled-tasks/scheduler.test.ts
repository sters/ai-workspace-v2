// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { insertScheduledTask, getScheduledTask } from "@/lib/db/scheduled-tasks";
import { tickScheduledTasks } from "@/lib/scheduled-tasks/scheduler";
import type { ScheduledTask, ScheduledTaskOverlap } from "@/types/scheduled-task";

const CREATED = new Date("2026-11-19T08:00:00");
const AT_NINE = new Date("2026-11-19T09:00:30");
const NEXT_NINE = new Date("2026-11-20T09:00:00").toISOString();

function task(overlap: ScheduledTaskOverlap = "skip", enabled = true): ScheduledTask {
  return insertScheduledTask(
    { title: "t", request: "r", prompt: "p", cron: "0 9 * * *", overlap, enabled },
    CREATED,
  );
}

function deps(running: Set<number> = new Set()) {
  return { isRunning: (id: number) => running.has(id), start: vi.fn(async (_task: ScheduledTask) => {}) };
}

describe("tickScheduledTasks", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("starts a due task and moves it to its next occurrence", async () => {
    const t = task();
    const d = deps();
    await tickScheduledTasks(AT_NINE, d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.start.mock.calls[0][0].id).toBe(t.id);
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(NEXT_NINE);
  });

  it("leaves a task alone before it is due, and a disabled one always", async () => {
    task();
    task("skip", false);
    const d = deps();
    await tickScheduledTasks(new Date("2026-11-19T08:59:59"), d);
    await tickScheduledTasks(new Date("2026-11-19T08:59:59"), d);
    expect(d.start).not.toHaveBeenCalled();
  });

  it("runs once for occurrences missed while the server was down", async () => {
    const t = task();
    const d = deps();
    await tickScheduledTasks(new Date("2026-11-25T12:00:00"), d);
    await tickScheduledTasks(new Date("2026-11-25T12:01:00"), d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(new Date("2026-11-26T09:00:00").toISOString());
  });

  it("skip: drops the occurrence while the previous run is going", async () => {
    const t = task("skip");
    const d = deps(new Set([t.id]));
    await tickScheduledTasks(AT_NINE, d);
    expect(d.start).not.toHaveBeenCalled();
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(NEXT_NINE);
    expect(getScheduledTask(t.id)!.queued).toBe(false);
  });

  it("parallel: starts another run beside the running one", async () => {
    const t = task("parallel");
    const d = deps(new Set([t.id]));
    await tickScheduledTasks(AT_NINE, d);
    expect(d.start).toHaveBeenCalledTimes(1);
  });

  it("queue: waits for the running one, then runs once", async () => {
    const t = task("queue");
    const running = new Set([t.id]);
    const d = deps(running);
    await tickScheduledTasks(AT_NINE, d);
    expect(d.start).not.toHaveBeenCalled();
    expect(getScheduledTask(t.id)!.queued).toBe(true);

    await tickScheduledTasks(new Date("2026-11-19T09:01:30"), d);
    expect(d.start).not.toHaveBeenCalled();

    running.clear();
    await tickScheduledTasks(new Date("2026-11-19T09:02:30"), d);
    await tickScheduledTasks(new Date("2026-11-19T09:03:30"), d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(getScheduledTask(t.id)!.queued).toBe(false);
  });

  it("queue: a queued run that becomes free on its next occurrence runs once, not twice", async () => {
    const t = task("queue");
    const running = new Set([t.id]);
    const d = deps(running);
    await tickScheduledTasks(AT_NINE, d);
    running.clear();
    await tickScheduledTasks(new Date("2026-11-20T09:00:30"), d);
    await tickScheduledTasks(new Date("2026-11-20T09:01:30"), d);
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(new Date("2026-11-21T09:00:00").toISOString());
  });

  it("keeps the occurrence due when the run cannot start, so the next tick retries", async () => {
    const t = task();
    const d = deps();
    d.start.mockRejectedValueOnce(new Error("Too many concurrent operations"));
    await tickScheduledTasks(AT_NINE, d);
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(new Date("2026-11-19T09:00:00").toISOString());

    await tickScheduledTasks(new Date("2026-11-19T09:01:30"), d);
    expect(d.start).toHaveBeenCalledTimes(2);
    expect(getScheduledTask(t.id)!.nextRunAt).toBe(NEXT_NINE);
  });
});
