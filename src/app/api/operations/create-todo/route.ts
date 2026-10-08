import { pathExists } from "@/lib/fs";
import { NextResponse } from "next/server";
import path from "node:path";
import { getWorkspaceDir, resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { createTodoSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";
import { buildCreateTodoPipeline } from "@/lib/pipelines/create-todo";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(createTodoSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const { reviewTimestamp, instruction, interactionLevel } = data;
  const wsPath = path.join(getWorkspaceDir(), workspace);

  // Validate review directory exists
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);
  if (!(await pathExists(reviewDir))) {
    return NextResponse.json(
      { error: `Review directory not found: ${reviewTimestamp}` },
      { status: 404 },
    );
  }

  const repos = await listWorkspaceRepos(workspace);
  if (repos.length === 0) {
    return NextResponse.json(
      { error: "No repositories found in workspace" },
      { status: 400 },
    );
  }

  try {
    const phases = buildCreateTodoPipeline(workspace, reviewTimestamp, instruction);
    const operation = startOperationPipeline("create-todo", workspace, phases, undefined, {
      reviewTimestamp,
      interactionLevel,
      ...(instruction && { instruction }),
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
