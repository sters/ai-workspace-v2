import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { initSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(initSchema, body);
  if (!parsed.success) return parsed.response;
  const { description } = parsed.data;

  try {
    const phases = buildInitPipeline(description);
    const operation = startOperationPipeline("init", "", phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
