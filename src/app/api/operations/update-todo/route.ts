import { NextResponse } from "next/server";
import {
  startOperationPipeline,
  ConcurrencyLimitError,
  killOperation,
  whenOperationFinished,
  findRunningOpByWorkspace,
  interjectsInFlight,
  subscribeToOperation,
} from "@/lib/pipeline-manager";
import { resolveWorkspaceName, getOperationConfig } from "@/lib/config";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";
import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
import { updateTodoSchema } from "@/lib/schemas";
import { parseBody, applyOperationDefaults } from "@/lib/validate";
import type { InteractionLevel } from "@/types/prompts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = parseBody(updateTodoSchema, body);
  if (!parsed.success) return parsed.response;
  const data = applyOperationDefaults(parsed.data);

  const workspace = resolveWorkspaceName(data.workspace);
  const { instruction, repo, interactionLevel, interject } = data;

  const bestOfN = data.bestOfN ?? getOperationConfig("update-todo").bestOfN;
  const bestOfNFromConfig = data.bestOfN == null;

  if (interject) {
    if (interjectsInFlight.has(workspace)) {
      return NextResponse.json(
        { error: `Interject already in flight for workspace ${workspace}` },
        { status: 409 },
      );
    }
    interjectsInFlight.add(workspace);

    try {
      const running = findRunningOpByWorkspace(workspace);
      const wasAutonomous = running?.operation.type === "autonomous";
      const autonomousInputs = wasAutonomous ? { ...(running?.operation.inputs ?? {}) } : undefined;

      if (running) {
        killOperation(running.operation.id);
        await whenOperationFinished(running.operation.id);
      }

      const phases = await buildUpdateTodoPipeline({
        workspace,
        instruction,
        repo,
        bestOfN: bestOfN >= 2 ? bestOfN : undefined,
        bestOfNConfirm: bestOfNFromConfig,
        interactionLevel,
        interject: true,
      });
      const operation = startOperationPipeline("update-todo", workspace, phases, undefined, {
        instruction,
        interactionLevel,
        ...(repo && { repo }),
        ...(bestOfN >= 2 && { bestOfN: String(bestOfN) }),
        interject: "true",
      });

      if (wasAutonomous && autonomousInputs) {
        subscribeToOperation(operation.id, (event) => {
          if (event.type !== "complete") return;
          let exitCode = 1;
          try {
            exitCode = JSON.parse(event.data).exitCode;
          } catch {
            // treat as failure
          }
          if (exitCode !== 0) return;

          try {
            const description = autonomousInputs.description;
            const instructionIn = autonomousInputs.instruction;
            const interactionLevelIn = autonomousInputs.interactionLevel as InteractionLevel | undefined;
            const draftIn = autonomousInputs.draft === "true";
            const repoIn = autonomousInputs.repo;
            const maxLoopsIn = autonomousInputs.maxLoops != null ? Number(autonomousInputs.maxLoops) : undefined;

            const rekickPhases = buildAutonomousPipeline({
              startWith: "execute",
              workspace,
              description,
              instruction: instructionIn,
              draft: draftIn,
              interactionLevel: interactionLevelIn,
              repo: repoIn,
              maxLoops: maxLoopsIn,
            });
            startOperationPipeline("autonomous", workspace, rekickPhases, undefined, {
              startWith: "execute",
              ...(description && { description }),
              ...(instructionIn && { instruction: instructionIn }),
              ...(interactionLevelIn && { interactionLevel: interactionLevelIn }),
              ...(autonomousInputs.draft != null && { draft: String(draftIn) }),
              ...(repoIn && { repo: repoIn }),
              ...(maxLoopsIn != null && { maxLoops: String(maxLoopsIn) }),
            });
          } catch (err) {
            console.error(
              `[update-todo interject] Failed to re-kick autonomous for workspace ${workspace}:`,
              err,
            );
          }
        });
      }

      return NextResponse.json(operation);
    } catch (err) {
      if (err instanceof ConcurrencyLimitError) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      return NextResponse.json({ error: String(err) }, { status: 500 });
    } finally {
      interjectsInFlight.delete(workspace);
    }
  }

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
      ...(repo && { repo }),
      ...(bestOfN >= 2 && { bestOfN: String(bestOfN) }),
    });
    return NextResponse.json(operation);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
