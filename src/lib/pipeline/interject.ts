import type { InteractionLevel } from "@/types/prompts";
import {
  killOperation,
  whenOperationFinished,
  startOperationPipeline,
  findRunningOpsByWorkspace,
  subscribeToOperation,
} from "@/lib/pipeline";
import { interjectsInFlight } from "./store";
import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";
import { buildUpdateTodoPipeline } from "@/lib/pipelines/update-todo";

export function acquireInterject(workspace: string): boolean {
  if (interjectsInFlight.has(workspace)) return false;
  interjectsInFlight.add(workspace);
  return true;
}

export function releaseInterject(workspace: string): void {
  interjectsInFlight.delete(workspace);
}

export async function killAndAwait(workspace: string): Promise<{
  wasAutonomous: boolean;
  autonomousInputs?: Record<string, string>;
}> {
  const running = findRunningOpsByWorkspace(workspace);
  // Several can run at once, one per repository; only the first autonomous one is restarted.
  const autonomous = running.find((managed) => managed.operation.type === "autonomous");

  for (const managed of running) {
    killOperation(managed.operation.id);
    await whenOperationFinished(managed.operation.id);
  }

  return autonomous
    ? { wasAutonomous: true, autonomousInputs: { ...(autonomous.operation.inputs ?? {}) } }
    : { wasAutonomous: false };
}

/**
 * Runs `start` once the source operation completes with exit code 0. A failure
 * inside `start` is logged but does not propagate — the source operation has
 * already completed and reported its own outcome.
 */
function onSuccess(sourceOperationId: string, what: string, start: () => Promise<void> | void): void {
  subscribeToOperation(sourceOperationId, (event) => {
    if (event.type !== "complete") return;
    let exitCode = 1;
    try {
      exitCode = JSON.parse(event.data).exitCode;
    } catch {
      // treat as failure
    }
    if (exitCode !== 0) return;

    Promise.resolve()
      .then(start)
      .catch((err) => console.error(`[interject] Failed to start ${what}:`, err));
  });
}

/**
 * After the source operation completes successfully, (re)start the autonomous
 * loop from `startWith` with the given inputs.
 */
export function scheduleAutonomousRekick(
  sourceOperationId: string,
  workspace: string,
  autonomousInputs: Record<string, string>,
  startWith: "execute" | "update-todo" = "execute",
): void {
  onSuccess(sourceOperationId, `autonomous for workspace ${workspace}`, () => {
    const description = autonomousInputs.description;
    const instruction = autonomousInputs.instruction;
    const interactionLevel = autonomousInputs.interactionLevel as InteractionLevel | undefined;
    const draft = autonomousInputs.draft === "true";
    const repo = autonomousInputs.repo;
    const maxLoops = autonomousInputs.maxLoops != null ? Number(autonomousInputs.maxLoops) : undefined;

    const phases = buildAutonomousPipeline({
      startWith,
      workspace,
      description,
      instruction,
      draft,
      interactionLevel,
      repo,
      maxLoops,
    });
    startOperationPipeline("autonomous", workspace, phases, undefined, {
      startWith,
      ...(description && { description }),
      ...(instruction && { instruction }),
      ...(interactionLevel && { interactionLevel }),
      ...(autonomousInputs.draft != null && { draft: String(draft) }),
      ...(repo && { repo }),
      ...(maxLoops != null && { maxLoops: String(maxLoops) }),
    });
  });
}

/** After the source operation completes successfully, start a standalone update-todo. */
export function scheduleUpdateTodo(
  sourceOperationId: string,
  workspace: string,
  instruction: string,
): void {
  onSuccess(sourceOperationId, `update-todo for workspace ${workspace}`, async () => {
    const phases = await buildUpdateTodoPipeline({ workspace, instruction });
    startOperationPipeline("update-todo", workspace, phases, undefined, { instruction });
  });
}
