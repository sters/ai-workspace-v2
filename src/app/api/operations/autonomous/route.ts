import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
import { autonomousSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(autonomousSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const { startWith, description, instruction, draft, interactionLevel, repo, maxLoops } = data;
  let workspace = data.workspace;

  if (startWith === "init") {
    if (!description || !description.trim()) {
      return NextResponse.json(
        { error: "description is required for init autonomous" },
        { status: 400 },
      );
    }
  } else {
    if (!workspace || !workspace.trim()) {
      return NextResponse.json(
        { error: "workspace is required for this autonomous mode" },
        { status: 400 },
      );
    }
    workspace = resolveWorkspaceName(workspace);
    const repos = listWorkspaceRepos(workspace);
    if (repos.length === 0) {
      return NextResponse.json(
        { error: "No repositories found in workspace" },
        { status: 400 },
      );
    }
  }

  try {
    const phases = buildAutonomousPipeline({
      startWith,
      description: description?.trim(),
      workspace,
      instruction,
      draft,
      interactionLevel,
      repo,
      maxLoops: maxLoops ?? 3,
    });
    const operation = startOperationPipeline(
      "autonomous",
      startWith === "init" ? "" : workspace!,
      phases,
      undefined,
      {
        startWith,
        ...(description?.trim() && { description: description.trim() }),
        ...(interactionLevel && { interactionLevel }),
        ...(instruction && { instruction }),
        ...(draft != null && { draft: String(draft) }),
        ...(repo && { repo }),
        ...(maxLoops != null && { maxLoops: String(maxLoops) }),
      },
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
