// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { createServerDeps, createWorkerDeps } from "@/lib/scheduled-tasks/client";
import type { ScheduledTask } from "@/types/scheduled-task";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("createServerDeps", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts a task as running only from its own run label", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, [
      { workspace: "scheduled-task-12" },
      { workspace: "scheduled-tasks" },
      { workspace: "scheduled-task-3x" },
      { workspace: "acme-widgets" },
    ])));
    const deps = await createServerDeps("http://localhost:1");
    expect([12, 3].map((id) => deps.isRunning({ id } as ScheduledTask))).toEqual([true, false]);
  });

  it("fails a start the server refused, so the occurrence stays due", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/run") ? respond(429, { error: "Too many concurrent operations" }) : respond(200, []),
    ));
    const deps = await createServerDeps("http://localhost:1");
    await expect(deps.start({ id: 1 } as ScheduledTask)).rejects.toThrow("Too many concurrent operations");
  });

  it("runs command tasks itself and asks the server only when a prompt task is among them", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes("/run") ? respond(200, {}) : respond(200, [])));
    vi.stubGlobal("fetch", fetchMock);
    const commands = { isRunning: vi.fn(() => false), start: vi.fn(async () => {}) };
    const getDeps = createWorkerDeps("http://localhost:1", commands);
    const command = { id: 1, kind: "command" } as ScheduledTask;
    const prompt = { id: 2, kind: "prompt" } as ScheduledTask;

    const commandOnly = await getDeps([command]);
    await commandOnly.start(command);
    expect(commands.start).toHaveBeenCalledWith(command);
    expect(fetchMock).not.toHaveBeenCalled();

    const both = await getDeps([command, prompt]);
    await both.start(prompt);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:1/api/operations?status=running",
      "http://localhost:1/api/scheduled-tasks/run",
    ]);
    expect(commands.start).toHaveBeenCalledTimes(1);
  });

  it("still runs command tasks when the server cannot be reached, failing only the prompt task's start", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const commands = { isRunning: vi.fn(() => false), start: vi.fn(async () => {}) };
    const command = { id: 1, kind: "command" } as ScheduledTask;
    const prompt = { id: 2, kind: "prompt" } as ScheduledTask;

    const deps = await createWorkerDeps("http://localhost:1", commands)([command, prompt]);
    await deps.start(command);
    expect(commands.start).toHaveBeenCalledWith(command);
    expect(deps.isRunning(prompt)).toBe(false);
    await expect(deps.start(prompt)).rejects.toThrow("ECONNREFUSED");
  });
});
