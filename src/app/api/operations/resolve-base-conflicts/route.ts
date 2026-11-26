import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildResolveBaseConflictsPipeline } from "@/lib/pipelines/resolve-base-conflicts";
import { resolveBaseConflictsSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(resolveBaseConflictsSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const repository = parsed.data.repo?.trim() || undefined;

  try {
    const phases = await buildResolveBaseConflictsPipeline({ workspace, repository });
    const operation = startOperationPipeline(
      "resolve-base-conflicts",
      workspace,
      phases,
      undefined,
      repository ? { repo: repository } : undefined,
    );
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
