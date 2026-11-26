import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildAddRepositoryPipeline } from "@/lib/pipelines/add-repository";
import { addRepositorySchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(addRepositorySchema, body);
  if (!parsed.success) return parsed.response;

  const { repository, baseBranch, branch } = parsed.data;
  const workspace = resolveWorkspaceName(parsed.data.workspace);
  try {
    const operation = startOperationPipeline(
      "add-repository",
      workspace,
      buildAddRepositoryPipeline({ workspace, repository, baseBranch, branch }),
      undefined,
      { repository, ...(baseBranch && { baseBranch }), ...(branch && { branch }) },
    );
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
