import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildPlanVerificationPipeline } from "@/lib/pipelines/plan-verification";
import { planVerificationSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(planVerificationSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const scenarioId = parsed.data.scenarioId?.trim() || undefined;
  const instruction = parsed.data.instruction?.trim() || undefined;

  try {
    const phases = buildPlanVerificationPipeline({ workspace, scenarioId, instruction });
    const operation = startOperationPipeline(
      "plan-verification",
      workspace,
      phases,
      undefined,
      scenarioId ? { scenarioId } : undefined,
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
