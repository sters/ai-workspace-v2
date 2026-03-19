import { NextResponse } from "next/server";
import { resolveWorkspaceName, getOperationConfig } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildCreatePrPipeline } from "@/lib/pipelines/create-pr";
import { buildBestOfNPipeline } from "@/lib/pipelines/best-of-n";
import { createPrSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(createPrSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const draft = data.draft;
  const repository = data.repository;
  const repos = listWorkspaceRepos(workspace);

  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 }
    );
  }

  const bestOfN = data.bestOfN ?? getOperationConfig("create-pr").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;

  try {
    let phases;
    if (bestOfN >= 2) {
      phases = await buildBestOfNPipeline({
        workspace,
        n: bestOfN,
        operationType: "create-pr",
        buildCandidatePhases: (candidateRepos) =>
          buildCreatePrPipeline({ workspace, draft: draft !== false, repos: candidateRepos }),
        repos,
        confirm: bestOfNFromConfig,
        buildNormalPhases: () => buildCreatePrPipeline({ workspace, draft: draft !== false, repository }),
        interactionLevel: data.interactionLevel,
      });
    } else {
      phases = await buildCreatePrPipeline({ workspace, draft: draft !== false, repository });
    }
    const operation = startOperationPipeline("create-pr", workspace, phases, undefined, {
      ...(draft === false && { draft: "false" }),
      ...(bestOfN >= 2 && { bestOfN: String(bestOfN) }),
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
