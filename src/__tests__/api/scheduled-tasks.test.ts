// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { GET, POST as create } from "@/app/api/scheduled-tasks/route";
import { POST as update } from "@/app/api/scheduled-tasks/update/route";
import { recordWorkerJobStart } from "@/lib/db/worker-jobs";

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

  it("lists the worker's built-in jobs with the state the worker last recorded", async () => {
    recordWorkerJobStart("scheduled-tasks", "2026-11-19T09:00:00.000Z");
    const { builtins } = await (await GET()).json();
    expect(builtins.map((b: { name: string }) => b.name)).toEqual(["pr-watcher", "scheduled-tasks"]);
    expect(builtins[1]).toMatchObject({ enabled: true, lastStartedAt: "2026-11-19T09:00:00.000Z" });
    expect(builtins[0].lastStartedAt).toBeNull();
  });
});
