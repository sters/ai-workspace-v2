import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildPruneSuggestionsPipeline } from "@/lib/pipelines/prune-suggestions";

export async function POST() {
  try {
    const phases = buildPruneSuggestionsPipeline();
    const operation = startOperationPipeline(
      "prune-suggestions",
      "prune-suggestions",
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
