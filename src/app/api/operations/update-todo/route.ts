import { startOperationPipeline, ConcurrencyLimitError } from "@/lib/pipeline-manager";
import {
  acquireInterject,
  releaseInterject,
  killAndAwait,
  scheduleAutonomousRekick,
} from "@/lib/pipeline/interject";
import { resolveWorkspaceName } from "@/lib/config";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const { instruction, repo, interactionLevel, interject } = data;

  if (interject) {
    if (!acquireInterject(workspace)) {
      return Response.json(
        { error: `Interject already in flight for workspace ${workspace}` },
        { status: 409 },
      );
    }

    try {
      const { wasAutonomous, autonomousInputs } = await killAndAwait(workspace);

      const phases = await buildUpdateTodoPipeline({
        workspace,
        instruction,
        repo,
        interject: true,
      });
      const operation = startOperationPipeline("update-todo", workspace, phases, undefined, {
        instruction,
        interactionLevel,
        ...(repo && { repo }),
        interject: "true",
      });

      if (wasAutonomous && autonomousInputs) {
        scheduleAutonomousRekick(operation.id, workspace, autonomousInputs);
      }

      return Response.json(operation);
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) {
        return Response.json({ error: err.message }, { status: 429 });
      }
      return Response.json({ error: String(err) }, { status: 500 });
    } finally {
      releaseInterject(workspace);
    }
  }

  try {
    const phases = await buildUpdateTodoPipeline({
      workspace,
      instruction,
      repo,
    });
    const operation = startOperationPipeline("update-todo", workspace, phases, undefined, {
      instruction,
      interactionLevel,
      ...(repo && { repo }),
    });
    return Response.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
