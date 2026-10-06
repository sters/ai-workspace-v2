import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildWorkspacePrunePipeline } from "@/lib/pipelines/workspace-prune";
import { workspacePruneSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(workspacePruneSchema, body);
  if (!parsed.success) return parsed.response;
  const d = parsed.data.days && parsed.data.days > 0 ? parsed.data.days : 7;
  const { archivedOnly } = parsed.data;

  try {
    const phases = buildWorkspacePrunePipeline({ days: d, archivedOnly });
    const operation = startOperationPipeline("workspace-prune", `prune-${d}d${archivedOnly ? "-archived" : ""}`, phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
