import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { resolveWorkspaceName } from "@/lib/config";
import { getOperationConfig } from "@/lib/app-config";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;

  const workspace = resolveWorkspaceName(parsed.data.workspace);
  const { instruction, repo, interactionLevel } = parsed.data;

  const bestOfN = parsed.data.bestOfN ?? getOperationConfig("update-todo").bestOfN;
  const bestOfNFromConfig = parsed.data.bestOfN == null;

  try {
    const phases = await buildUpdateTodoPipeline({
      workspace,
      instruction,
      repo,
      bestOfN: bestOfN >= 2 ? bestOfN : undefined,
      bestOfNConfirm: bestOfNFromConfig,
      interactionLevel,
    });
    const operation = startOperationPipeline("update-todo", workspace, phases, undefined, {
      instruction,
      interactionLevel,
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
