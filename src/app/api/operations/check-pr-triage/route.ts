import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildCheckPrTriagePipeline } from "@/lib/pipelines/check-pr-triage";
import { checkPrTriageSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(checkPrTriageSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  try {
    const operation = startOperationPipeline("check-pr-triage", workspace, buildCheckPrTriagePipeline({ workspace }));
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
