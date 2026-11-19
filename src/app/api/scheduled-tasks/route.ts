import { NextResponse } from "next/server";
import { insertScheduledTask, listScheduledTasks } from "@/lib/db/scheduled-tasks";
import { scheduledTaskInputSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ tasks: listScheduledTasks() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskInputSchema, body);
  if (!parsed.success) return parsed.response;
  return NextResponse.json(insertScheduledTask(parsed.data));
}
