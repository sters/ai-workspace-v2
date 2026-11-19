// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { createServerDeps } from "@/lib/scheduled-tasks/client";
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
    expect([12, 3].map(deps.isRunning)).toEqual([true, false]);
  });

  it("fails a start the server refused, so the occurrence stays due", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/run") ? respond(429, { error: "Too many concurrent operations" }) : respond(200, []),
    ));
    const deps = await createServerDeps("http://localhost:1");
    await expect(deps.start({ id: 1 } as ScheduledTask)).rejects.toThrow("Too many concurrent operations");
  });
});
