import { updateScheduledTask } from "@/lib/db/scheduled-tasks";
import { scheduledTaskUpdateSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskUpdateSchema, body);
  if (!parsed.success) return parsed.response;

  const { id, ...input } = parsed.data;
  const task = updateScheduledTask(id, input);
  if (!task) return Response.json({ error: "Scheduled task not found" }, { status: 404 });
  return Response.json(task);
}
