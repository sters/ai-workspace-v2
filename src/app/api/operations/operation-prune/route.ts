import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildOperationPrunePipeline } from "@/lib/pipelines/operation-prune";
import { operationPruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(operationPruneSchema, body);
  if (!parsed.success) return parsed.response;
  const d = parsed.data.days && parsed.data.days > 0 ? parsed.data.days : 7;
  const { archivedOnly } = parsed.data;

  try {
    const phases = buildOperationPrunePipeline({ days: d, archivedOnly });
    const operation = startOperationPipeline("operation-prune", `op-prune-${d}d${archivedOnly ? "-archived" : ""}`, phases);
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
