import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildPlanScheduledTaskPipeline, SCHEDULED_TASKS_LABEL } from "@/lib/pipelines/scheduled-task";
import { planScheduledTaskSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(planScheduledTaskSchema, body);
  if (!parsed.success) return parsed.response;

  try {
    const { request: taskRequest } = parsed.data;
    const operation = startOperationPipeline(
      "plan-scheduled-task",
      SCHEDULED_TASKS_LABEL,
      buildPlanScheduledTaskPipeline(taskRequest),
      undefined,
      { request: taskRequest },
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
