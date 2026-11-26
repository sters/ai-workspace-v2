import { insertScheduledTask, listScheduledTasks } from "@/lib/db/scheduled-tasks";
import { scheduledTaskInputSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export function GET() {
  return Response.json({ tasks: listScheduledTasks() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskInputSchema, body);
  if (!parsed.success) return parsed.response;
  return Response.json(insertScheduledTask(parsed.data));
}
