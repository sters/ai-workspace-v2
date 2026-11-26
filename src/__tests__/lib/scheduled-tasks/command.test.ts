import { describe, expect, it, beforeEach } from "bun:test";
import { waitFor } from "@/__tests__/helpers/mocks";
import { getDb, _resetDb, _setDbPath } from "@/lib/db";
import { getScheduledTask, insertScheduledTask } from "@/lib/db/scheduled-tasks";
import { createCommandRunner } from "@/lib/scheduled-tasks/command";

function commandTask(prompt: string) {
  return insertScheduledTask({ title: "t", request: "", kind: "command", prompt, cron: "* * * * *", overlap: "skip", enabled: true });
}

describe("createCommandRunner", () => {
  beforeEach(() => {
    _resetDb();
    _setDbPath(":memory:");
    getDb();
  });

  it("runs the command in the background and records how it ended", async () => {
    const runner = createCommandRunner({ cwd: process.cwd(), env: { ...process.env, GREETING: "hi" } });
    const task = commandTask('echo "$GREETING"; echo oops >&2; sleep 0.2; exit 3');
    await runner.start(task);
    expect(runner.isRunning(task)).toBe(true);
    expect(getScheduledTask(task.id)!.lastRunAt).toEqual(expect.any(String));

    await waitFor(() => expect(runner.isRunning(task)).toBe(false), { timeout: 5000 });
    const after = getScheduledTask(task.id)!;
    expect(after.lastExitCode).toBe(3);
    expect(after.lastOutput).toContain("hi");
    expect(after.lastOutput).toContain("oops");
  });

  it("counts a task as running until every parallel run of it has finished", async () => {
    const runner = createCommandRunner({ cwd: process.cwd(), env: process.env });
    const task = commandTask("sleep 0.1");
    await runner.start(task);
    await runner.start(task);
    await waitFor(() => expect(runner.isRunning(task)).toBe(false), { timeout: 5000 });
    expect(getScheduledTask(task.id)!.lastExitCode).toBe(0);
  });
});
