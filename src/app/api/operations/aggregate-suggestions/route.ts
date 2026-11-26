import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildAggregateSuggestionsPipeline } from "@/lib/pipelines/aggregate-suggestions";

export async function POST() {
  try {
    const phases = buildAggregateSuggestionsPipeline();
    const operation = startOperationPipeline(
      "aggregate-suggestions",
      "aggregate-suggestions",
      phases,
    );
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
