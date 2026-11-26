import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildHarvestLessonsPipeline } from "@/lib/pipelines/harvest-lessons";
import { harvestLessonsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(harvestLessonsSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  try {
    const operation = startOperationPipeline("harvest-lessons", workspace, buildHarvestLessonsPipeline(workspace));
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
