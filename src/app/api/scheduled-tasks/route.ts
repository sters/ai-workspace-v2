import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { insertScheduledTask, listScheduledTasks } from "@/lib/db/scheduled-tasks";
import { scheduledTaskInputSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { listBuiltinWorkerJobs } from "@/lib/worker-jobs";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ tasks: listScheduledTasks(), builtins: listBuiltinWorkerJobs(getConfig()) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(scheduledTaskInputSchema, body);
  if (!parsed.success) return parsed.response;
  return NextResponse.json(insertScheduledTask(parsed.data));
}
