import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildReviewPipeline } from "@/lib/pipelines/review";
import { reviewSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(reviewSchema, body);
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

  // A review a human started verifies the comments already on the PR alongside
  // the code. An autonomous cycle does not: its asks come from its own gate.
  const reviewInput = {
    workspace,
    repository: data.repository,
    carryPostedFindings: true,
  };

  try {
    const phases = await buildReviewPipeline({
      ...reviewInput,
      refreshFromRemote: data.refreshFromRemote,
    });
    const operation = startOperationPipeline("review", workspace, phases, undefined,
      data.refreshFromRemote ? { refreshFromRemote: "true" } : undefined,
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
