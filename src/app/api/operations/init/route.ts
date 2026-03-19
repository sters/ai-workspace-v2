import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { getOperationConfig } from "@/lib/config";
import { buildInitPipeline } from "@/lib/pipelines/init";
import { initSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(initSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);
  const { description, interactionLevel } = data;

  const bestOfN = data.bestOfN ?? getOperationConfig("init").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;

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
