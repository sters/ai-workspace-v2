import { NextResponse } from "next/server";
import { getScheduledTask, updateScheduledTaskState } from "@/lib/db/scheduled-tasks";
import { ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { startScheduledTaskRun } from "@/lib/scheduled-tasks";
import { scheduledTaskIdSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Starts one run of a task. The worker's scheduler calls it once it has
 * applied the overlap setting; Run now calls it directly, outside the schedule.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskIdSchema, body);
  if (!parsed.success) return parsed.response;

  const task = getScheduledTask(parsed.data.id);
  if (!task) return NextResponse.json({ error: "Scheduled task not found" }, { status: 404 });
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
