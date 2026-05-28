import type { InteractionLevel } from "@/types/prompts";
import {
  killOperation,
  whenOperationFinished,
  startOperationPipeline,
  findRunningOpByWorkspace,
  subscribeToOperation,
} from "@/lib/pipeline";
import { interjectsInFlight } from "./store";
import { buildAutonomousPipeline } from "@/lib/pipelines/autonomous";

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
  const running = findRunningOpByWorkspace(workspace);
  if (!running) return { wasAutonomous: false };

  const wasAutonomous = running.operation.type === "autonomous";
  const autonomousInputs = wasAutonomous ? { ...(running.operation.inputs ?? {}) } : undefined;

  killOperation(running.operation.id);
  await whenOperationFinished(running.operation.id);

  return wasAutonomous && autonomousInputs
    ? { wasAutonomous: true, autonomousInputs }
    : { wasAutonomous: false };
}

/**
 * After an interject-driven update completes successfully, restart the
 * autonomous loop from execute using the captured original inputs. Failure
 * to re-kick is logged but does not propagate — the source update operation
 * has already completed and reported its own outcome.
 */
export function scheduleAutonomousRekick(
  sourceOperationId: string,
  workspace: string,
  autonomousInputs: Record<string, string>,
): void {
  subscribeToOperation(sourceOperationId, (event) => {
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
      const instruction = autonomousInputs.instruction;
      const interactionLevel = autonomousInputs.interactionLevel as InteractionLevel | undefined;
      const draft = autonomousInputs.draft === "true";
      const repo = autonomousInputs.repo;
      const maxLoops = autonomousInputs.maxLoops != null ? Number(autonomousInputs.maxLoops) : undefined;

      const phases = buildAutonomousPipeline({
        startWith: "execute",
        workspace,
        description,
        instruction,
        draft,
        interactionLevel,
        repo,
        maxLoops,
      });
      startOperationPipeline("autonomous", workspace, phases, undefined, {
        startWith: "execute",
        ...(description && { description }),
        ...(instruction && { instruction }),
        ...(interactionLevel && { interactionLevel }),
        ...(autonomousInputs.draft != null && { draft: String(draft) }),
        ...(repo && { repo }),
        ...(maxLoops != null && { maxLoops: String(maxLoops) }),
      });
    } catch (err) {
      console.error(
        `[interject] Failed to re-kick autonomous for workspace ${workspace}:`,
        err,
      );
    }
  });
}
