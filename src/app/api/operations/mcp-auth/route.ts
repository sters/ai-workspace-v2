import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { buildMcpAuthPipeline } from "@/lib/pipelines/mcp-auth";
import { mcpAuthSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(mcpAuthSchema, body);
  if (!parsed.success) return parsed.response;

  const { serverName, forceReauth } = parsed.data;
  const isReauth = forceReauth === true || forceReauth === "true";

  try {
    const phases = buildMcpAuthPipeline(serverName, isReauth);
    const operation = startOperationPipeline("mcp-auth", `mcp:${serverName}`, phases);
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
