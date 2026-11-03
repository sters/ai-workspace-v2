import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError, WorkspaceBusyError } from "@/lib/pipeline";
import { buildBenchPipeline } from "@/lib/pipelines/bench";
import { BENCH_STEPS } from "@/lib/bench/steps";
import { benchSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(benchSchema, body);
  if (!parsed.success) return parsed.response;
  const input = parsed.data;

  const step = BENCH_STEPS.get(input.step);
  if (!step) return NextResponse.json({ error: `Unknown bench step: ${input.step}` }, { status: 400 });
  if (step.perRepo && !input.repo) return NextResponse.json({ error: `${step.label} runs against one repository` }, { status: 400 });

  try {
    const operation = startOperationPipeline("bench", input.workspace, buildBenchPipeline(input), undefined, {
      step: input.step,
      ...(input.repo && { repo: input.repo }),
    });
    return NextResponse.json(operation);
  } catch (err) {
    // WorkspaceBusyError is a ConcurrencyLimitError, so it is checked first.
    if (err instanceof WorkspaceBusyError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof ConcurrencyLimitError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
