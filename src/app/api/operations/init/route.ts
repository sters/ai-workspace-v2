import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { initSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(initSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);
  const { description, interactionLevel } = data;

  try {
    const phases = buildInitPipeline(description, interactionLevel);
    const operation = startOperationPipeline("init", "", phases, undefined, {
      description,
      interactionLevel,
    });
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
