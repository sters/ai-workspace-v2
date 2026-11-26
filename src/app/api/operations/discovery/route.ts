import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildDiscoveryPipeline } from "@/lib/pipelines/discovery";

export async function POST() {
  try {
    const phases = buildDiscoveryPipeline();
    const operation = startOperationPipeline("discovery", "discovery", phases);
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
