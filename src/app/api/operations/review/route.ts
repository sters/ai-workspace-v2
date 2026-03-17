import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { getOperationConfig } from "@/lib/app-config";
import { buildReviewPipeline } from "@/lib/pipelines/review";
import { buildBestOfNPipeline } from "@/lib/pipelines/best-of-n";
import { reviewSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(reviewSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const repos = listWorkspaceRepos(workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  const bestOfN = parsed.data.bestOfN ?? getOperationConfig("review").bestOfN;
  const bestOfNFromConfig = parsed.data.bestOfN == null;

  try {
    let phases;
    if (bestOfN >= 2) {
      phases = await buildBestOfNPipeline({
        workspace,
        n: bestOfN,
        operationType: "review",
        buildCandidatePhases: (candidateRepos) =>
          buildReviewPipeline({ workspace, repos: candidateRepos }),
        repos,
        confirm: bestOfNFromConfig,
        buildNormalPhases: () => buildReviewPipeline({ workspace, repository: parsed.data.repository }),
        interactionLevel: parsed.data.interactionLevel,
      });
    } else {
      phases = await buildReviewPipeline({ workspace, repository: parsed.data.repository });
    }
    const operation = startOperationPipeline("review", workspace, phases, undefined,
      bestOfN >= 2 ? { bestOfN: String(bestOfN) } : undefined,
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
