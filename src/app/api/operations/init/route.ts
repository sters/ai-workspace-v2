import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { getConfig } from "@/lib/app-config";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { initSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(initSchema, body);
  if (!parsed.success) return parsed.response;
  const { description, interactionLevel } = parsed.data;

  const bestOfN = parsed.data.bestOfN ?? getConfig().operations.bestOfN;
  const bestOfNFromConfig = parsed.data.bestOfN == null;

  try {
    const phases = buildInitPipeline(description, interactionLevel, {
      bestOfN: bestOfN >= 2 ? bestOfN : undefined,
      bestOfNConfirm: bestOfNFromConfig,
    });
    const operation = startOperationPipeline("init", "", phases, undefined, {
      description,
      interactionLevel,
      ...(bestOfN >= 2 && { bestOfN: String(bestOfN) }),
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
