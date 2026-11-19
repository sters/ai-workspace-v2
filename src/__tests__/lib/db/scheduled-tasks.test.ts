// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import {
  insertScheduledTask,
  updateScheduledTask,
  getScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
} from "@/lib/db/scheduled-tasks";
import type { ScheduledTaskInput } from "@/types/scheduled-task";

const NOW = new Date("2026-11-19T10:07:00");

function input(over: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput {
  return {
    title: "Watch CI",
    request: "tell me when main is red",
    prompt: "Check the latest CI run on main.",
    cron: "0 9 * * *",
    overlap: "skip",
    enabled: true,
    ...over,
  };
}

describe("db/scheduled-tasks", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("schedules an enabled task at its next cron occurrence", () => {
    const task = insertScheduledTask(input(), NOW);
    expect(task.nextRunAt).toBe(new Date("2026-11-20T09:00:00").toISOString());
  });

  it("gives a disabled task no next run", () => {
    expect(insertScheduledTask(input({ enabled: false }), NOW).nextRunAt).toBeNull();
  });

  it("reschedules from the new cron on edit, and clears a queued run when disabled", () => {
    const task = insertScheduledTask(input(), NOW);
    getDb().run("UPDATE scheduled_tasks SET queued = 1 WHERE id = ?", [task.id]);

    const edited = updateScheduledTask(task.id, input({ cron: "30 10 * * *" }), NOW)!;
    expect(edited.nextRunAt).toBe(new Date("2026-11-19T10:30:00").toISOString());
    expect(edited.queued).toBe(true);

    const disabled = updateScheduledTask(task.id, input({ enabled: false }), NOW)!;
    expect(disabled.nextRunAt).toBeNull();
    expect(disabled.queued).toBe(false);
  });

  it("reports a missing task on update and delete", () => {
    expect(updateScheduledTask(999, input(), NOW)).toBeNull();
    expect(deleteScheduledTask(999)).toBe(false);
  });

  it("deletes only the task it is given", () => {
    const a = insertScheduledTask(input({ title: "A" }), NOW);
    insertScheduledTask(input({ title: "B" }), NOW);
    expect(deleteScheduledTask(a.id)).toBe(true);
    expect(getScheduledTask(a.id)).toBeNull();
    expect(listScheduledTasks().map((t) => t.title)).toEqual(["B"]);
  });
});
