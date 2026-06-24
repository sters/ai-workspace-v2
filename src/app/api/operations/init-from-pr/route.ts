import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildInitFromPrPipeline } from "@/lib/pipelines/init-from-pr";
import { initFromPrSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(initFromPrSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);
  const { prUrl, interactionLevel, todoInstruction, withReview } = data;
  const trimmedTodo = todoInstruction?.trim();

  try {
    const phases = buildInitFromPrPipeline(prUrl, {
      interactionLevel,
      todoInstruction: trimmedTodo,
      withReview,
    });
    const operation = startOperationPipeline("init-from-pr", "", phases, undefined, {
      prUrl,
      interactionLevel,
      ...(trimmedTodo ? { todoInstruction: trimmedTodo } : {}),
      ...(withReview ? { withReview: "true" } : {}),
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
