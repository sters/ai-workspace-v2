import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_DIR, resolveWorkspaceName } from "@/lib/config";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { listWorkspaceRepos } from "@/lib/workspace";
import { createTodoSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";
import { buildCreateTodoPipeline } from "@/lib/pipelines/create-todo";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(createTodoSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const { reviewTimestamp, instruction, interactionLevel } = parsed.data;
  const wsPath = path.join(WORKSPACE_DIR, workspace);

  // Validate review directory exists
  const reviewDir = path.join(wsPath, "artifacts", "reviews", reviewTimestamp);
  if (!existsSync(reviewDir)) {
    return NextResponse.json(
      { error: `Review directory not found: ${reviewTimestamp}` },
      { status: 404 },
    );
  }

  const repos = listWorkspaceRepos(workspace);
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
    throw err;
  }
}
