import { NextResponse } from "next/server";
import { deleteScheduledTask } from "@/lib/db/scheduled-tasks";
import { scheduledTaskIdSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskIdSchema, body);
  if (!parsed.success) return parsed.response;

  if (!deleteScheduledTask(parsed.data.id)) {
    return NextResponse.json({ error: "Scheduled task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
