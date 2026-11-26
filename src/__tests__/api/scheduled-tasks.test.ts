import { describe, expect, it, beforeEach } from "bun:test";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { GET, POST as create } from "@/app/api/scheduled-tasks/route";
import { POST as update } from "@/app/api/scheduled-tasks/update/route";
import { POST as remove } from "@/app/api/scheduled-tasks/delete/route";
import { POST as run } from "@/app/api/scheduled-tasks/run/route";
import { ensureBuiltinScheduledTask, getScheduledTask } from "@/lib/db/scheduled-tasks";

const body = { title: "Watch CI", request: "", prompt: "Check main.", cron: "0 9 * * 1-5", overlap: "queue", enabled: false };

function post(handler: (r: Request) => Promise<Response>, payload: unknown) {
  return handler(new Request("http://localhost/", { method: "POST", body: JSON.stringify(payload) }));
}

describe("/api/scheduled-tasks", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("refuses a cron expression the scheduler could never run", async () => {
    expect((await post(create, { ...body, cron: "every morning" })).status).toBe(400);
    expect((await post(create, { ...body, cron: "0 0 30 2 *" })).status).toBe(400);
    expect((await (await GET()).json()).tasks).toEqual([]);
  });

  it("schedules a task once it is enabled, and reports a missing one", async () => {
    const created = await (await post(create, body)).json();
    expect(created.nextRunAt).toBeNull();

    const enabled = await (await post(update, { ...body, id: created.id, enabled: true })).json();
    expect(enabled.nextRunAt).toEqual(expect.any(String));

    expect((await post(update, { ...body, id: 999 })).status).toBe(404);
  });

  it("creates an instruction task when no kind is given", async () => {
    expect((await (await post(create, body)).json()).kind).toBe("prompt");
  });

  it("refuses to delete a built-in task", async () => {
    const task = ensureBuiltinScheduledTask("pr-watcher", { ...body, kind: "command", overlap: "skip" });
    expect((await post(remove, { id: task.id })).status).toBe(409);
    expect(getScheduledTask(task.id)).not.toBeNull();
  });

  it("runs an enabled command task now by making it due for the worker, and refuses a disabled one", async () => {
    const created = await (await post(create, { ...body, kind: "command", prompt: "echo hi", enabled: true })).json();
    const res = await post(run, { id: created.id });
    expect(res.status).toBe(200);
    expect(new Date(getScheduledTask(created.id)!.nextRunAt!).getTime()).toBeLessThanOrEqual(Date.now());

    const disabled = await (await post(create, { ...body, kind: "command", prompt: "echo hi" })).json();
    expect((await post(run, { id: disabled.id })).status).toBe(409);
  });
});
