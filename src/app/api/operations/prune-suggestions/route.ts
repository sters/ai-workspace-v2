import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildPruneSuggestionsPipeline } from "@/lib/pipelines/prune-suggestions";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const phases = buildPruneSuggestionsPipeline();
    const operation = startOperationPipeline(
      "prune-suggestions",
      "prune-suggestions",
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
