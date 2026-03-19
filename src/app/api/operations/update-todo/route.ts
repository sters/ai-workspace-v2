import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import { resolveWorkspaceName, getOperationConfig } from "@/lib/config";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const { instruction, repo, interactionLevel } = data;

  const bestOfN = data.bestOfN ?? getOperationConfig("update-todo").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;

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
