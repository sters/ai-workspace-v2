import type { PipelinePhase } from "@/types/pipeline";
import type { OperationPhaseInfo } from "@/types/operation";
import type { ManagedOperation } from "./types";
import { emitStatus } from "./events";

/** Helper to derive a label for a pipeline phase. */
export function getPhaseLabel(phase: PipelinePhase, index: number): string {
  if (phase.kind === "single" || phase.kind === "function") return phase.label;
  return `Phase ${index + 1}: ${phase.children.map((c) => c.label).join(", ")}`;
}

/** Emit a __phaseUpdate status event so the client can track phase lifecycle. */
export function emitPhaseUpdate(
  managed: ManagedOperation,
  phaseIndex: number,
  phaseLabel: string,
  phaseStatus: OperationPhaseInfo["status"],
) {
  const phases = managed.operation.phases;
  if (phases && phases[phaseIndex]) {
    phases[phaseIndex].status = phaseStatus;
  }
  emitStatus(managed, `__phaseUpdate:${JSON.stringify({ phaseIndex, phaseLabel, phaseStatus })}`, {
    phaseIndex,
    phaseLabel,
  });
}
