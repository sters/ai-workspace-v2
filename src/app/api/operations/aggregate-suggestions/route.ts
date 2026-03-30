import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildAggregateSuggestionsPipeline } from "@/lib/pipelines/aggregate-suggestions";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const phases = buildAggregateSuggestionsPipeline();
    const operation = startOperationPipeline(
      "aggregate-suggestions",
      "aggregate-suggestions",
      phases,
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
