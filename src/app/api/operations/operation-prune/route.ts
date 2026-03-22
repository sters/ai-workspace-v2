import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildOperationPrunePipeline } from "@/lib/pipelines/operation-prune";
import { operationPruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(operationPruneSchema, body);
  if (!parsed.success) return parsed.response;
  const d = parsed.data.days && parsed.data.days > 0 ? parsed.data.days : 7;

  try {
    const phases = buildOperationPrunePipeline(d);
    const operation = startOperationPipeline("operation-prune", `op-prune-${d}d`, phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
