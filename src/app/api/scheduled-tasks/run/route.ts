import { NextResponse } from "next/server";
import { getScheduledTask, updateScheduledTaskState } from "@/lib/db/scheduled-tasks";
import { ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { startScheduledTaskRun } from "@/lib/scheduled-tasks";
import { scheduledTaskIdSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Starts one run of a `prompt` task. The worker's scheduler calls it once it
 * has applied the overlap setting; Run now calls it directly, outside the
 * schedule. A `command` task runs only in the worker, so Run now makes it due
 * and the worker's next tick (within a minute) starts it.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskIdSchema, body);
  if (!parsed.success) return parsed.response;

  const task = getScheduledTask(parsed.data.id);
  if (!task) return NextResponse.json({ error: "Scheduled task not found" }, { status: 404 });
  if (task.kind === "command") {
    if (!task.enabled) {
      return NextResponse.json({ error: "Enable the task first; the worker runs only enabled commands." }, { status: 409 });
    }
    updateScheduledTaskState(task.id, { nextRunAt: new Date().toISOString() });
    return NextResponse.json({ ok: true });
  }
  try {
    const operation = startScheduledTaskRun(task);
    updateScheduledTaskState(task.id, { lastRunAt: operation.startedAt });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
