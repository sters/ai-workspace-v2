import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { executeSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(executeSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const repos = await listWorkspaceRepos(workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  try {
    const phases = await buildExecutePipeline({ workspace, repository: data.repository });
    const operation = startOperationPipeline("execute", workspace, phases);
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
