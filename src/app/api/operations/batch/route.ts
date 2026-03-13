import { NextResponse } from "next/server";
import { resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { buildBatchPipeline } from "@/lib/pipelines/batch";
import { batchSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(batchSchema, body);
  if (!parsed.success) return parsed.response;

  const { mode, startWith, description, instruction, draft, interactionLevel } = parsed.data;
  let workspace = parsed.data.workspace;

  if (startWith === "init") {
    if (!description || !description.trim()) {
      return NextResponse.json(
        { error: "description is required for init batch" },
        { status: 400 },
      );
    }
  } else {
    if (!workspace || !workspace.trim()) {
      return NextResponse.json(
        { error: "workspace is required for this batch mode" },
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
    const phases = buildBatchPipeline({
      mode,
      startWith,
      description: description?.trim(),
      workspace,
      instruction,
      draft,
      interactionLevel,
    });
    const operation = startOperationPipeline(
      "batch",
      startWith === "init" ? "" : workspace!,
      phases,
      undefined,
      {
        mode,
        startWith,
        ...(description?.trim() && { description: description.trim() }),
        ...(interactionLevel && { interactionLevel }),
        ...(instruction && { instruction }),
        ...(draft != null && { draft: String(draft) }),
      },
    );
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
}
