import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildClaudeLoginPipeline } from "@/lib/pipelines/claude-login";

export async function POST() {
  try {
    const phases = buildClaudeLoginPipeline();
    const operation = startOperationPipeline("claude-login", "claude-login", phases);
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
