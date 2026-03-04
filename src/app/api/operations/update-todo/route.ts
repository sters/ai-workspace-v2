import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { resolveWorkspaceName } from "@/lib/config";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const { instruction } = parsed.data;

  try {
    const phases = await buildUpdateTodoPipeline({ workspace, instruction });
    const operation = startOperationPipeline("update-todo", workspace, phases, undefined, { instruction });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
