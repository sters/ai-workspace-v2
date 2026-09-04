import { NextResponse } from "next/server";
import { resolveWorkspaceName, getOperationConfig } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildReviewPipeline } from "@/lib/pipelines/review";
import { buildBestOfNPipeline } from "@/lib/pipelines/best-of-n";
import { buildRefreshWorktreesPhase } from "@/lib/pipelines/actions/refresh-worktrees";
import { reviewSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(reviewSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const repos = listWorkspaceRepos(workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  const bestOfN = data.bestOfN ?? getOperationConfig("review").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;
  // A review a human started verifies the comments already on the PR alongside
  // the code. An autonomous cycle does not: its asks come from its own gate.
  const reviewInput = {
    workspace,
    repository: data.repository,
    carryPostedFindings: true,
  };

  try {
    let phases;
    if (bestOfN >= 2) {
      const bestOfNPhases = await buildBestOfNPipeline({
        workspace,
        n: bestOfN,
        operationType: "review",
        buildCandidatePhases: (candidateRepos) =>
          buildReviewPipeline({ ...reviewInput, repository: undefined, repos: candidateRepos }),
        repos,
        confirm: bestOfNFromConfig,
        buildNormalPhases: () => buildReviewPipeline(reviewInput),
        interactionLevel: data.interactionLevel,
      });
      // The refresh is prepended here rather than passed through, because
      // Best-of-N already builds both its candidate and its fall-back phases
      // lazily — inside a phase that runs after this one. The plain path below
      // has to defer its build instead, which `refreshFromRemote` does for it.
      phases = data.refreshFromRemote
        ? [buildRefreshWorktreesPhase({ workspace, repository: data.repository }), ...bestOfNPhases]
        : bestOfNPhases;
    } else {
      phases = await buildReviewPipeline({
        ...reviewInput,
        refreshFromRemote: data.refreshFromRemote,
      });
    }
    const inputs: Record<string, string> = {
      ...(bestOfN >= 2 ? { bestOfN: String(bestOfN) } : {}),
      ...(data.refreshFromRemote ? { refreshFromRemote: "true" } : {}),
    };
    const operation = startOperationPipeline("review", workspace, phases, undefined,
      Object.keys(inputs).length > 0 ? inputs : undefined,
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
