import { NextResponse } from "next/server";
import { resolveWorkspaceName, getOperationConfig } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildExecutePipeline } from "@/lib/pipelines/execute";
import { buildBestOfNPipeline } from "@/lib/pipelines/best-of-n";
import { executeSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(executeSchema, body);
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

  const bestOfN = data.bestOfN ?? getOperationConfig("execute").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;

  try {
    let phases;
    if (bestOfN >= 2) {
      phases = await buildBestOfNPipeline({
        workspace,
        n: bestOfN,
        operationType: "execute",
        buildCandidatePhases: (candidateRepos) =>
          buildExecutePipeline({ workspace, repos: candidateRepos }),
        repos,
        confirm: bestOfNFromConfig,
        buildNormalPhases: () => buildExecutePipeline({ workspace, repository: data.repository }),
        interactionLevel: data.interactionLevel,
      });
    } else {
      phases = await buildExecutePipeline({ workspace, repository: data.repository });
    }
    const operation = startOperationPipeline("execute", workspace, phases, undefined,
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
