import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildWorkspacePrunePipeline } from "@/lib/pipelines/workspace-prune";
import { workspacePruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(workspacePruneSchema, body);
  if (!parsed.success) return parsed.response;
  const d = parsed.data.days && parsed.data.days > 0 ? parsed.data.days : 7;

  try {
    const phases = buildWorkspacePrunePipeline(d);
    const operation = startOperationPipeline("workspace-prune", `prune-${d}d`, phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
