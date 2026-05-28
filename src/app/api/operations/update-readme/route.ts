import { NextResponse } from "next/server";
import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import {
  acquireInterject,
  releaseInterject,
  killAndAwait,
  scheduleAutonomousRekick,
} from "@/lib/pipeline/interject";
import { resolveWorkspaceName } from "@/lib/config";
import { buildUpdateReadmePipeline } from "@/lib/pipelines/update-readme";
import { updateReadmeSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(updateReadmeSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const { instruction, interactionLevel, interject } = data;

  if (interject) {
    if (!acquireInterject(workspace)) {
      return NextResponse.json(
        { error: `Interject already in flight for workspace ${workspace}` },
        { status: 409 },
      );
    }

    try {
      const { wasAutonomous, autonomousInputs } = await killAndAwait(workspace);

      const phases = await buildUpdateReadmePipeline({
        workspace,
        instruction,
        interactionLevel,
        interject: true,
      });
      const operation = startOperationPipeline("update-readme", workspace, phases, undefined, {
        instruction,
        interactionLevel,
        interject: "true",
      });

      if (wasAutonomous && autonomousInputs) {
        scheduleAutonomousRekick(operation.id, workspace, autonomousInputs);
      }

      return NextResponse.json(operation);
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json({ error: String(err) }, { status: 500 });
    } finally {
      releaseInterject(workspace);
    }
  }

  try {
    const phases = await buildUpdateReadmePipeline({
      workspace,
      instruction,
      interactionLevel,
    });
    const operation = startOperationPipeline("update-readme", workspace, phases, undefined, {
      instruction,
      interactionLevel,
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
