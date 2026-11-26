import { deleteScheduledTask, getScheduledTask } from "@/lib/db/scheduled-tasks";
import { scheduledTaskIdSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskIdSchema, body);
  if (!parsed.success) return parsed.response;

  const task = getScheduledTask(parsed.data.id);
  if (!task) return Response.json({ error: "Scheduled task not found" }, { status: 404 });
  if (task.builtin) {
    return Response.json({ error: "A built-in task cannot be deleted; disable it instead." }, { status: 409 });
  }
  deleteScheduledTask(task.id);
  return Response.json({ ok: true });
}
