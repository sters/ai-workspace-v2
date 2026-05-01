import type { PipelinePhase, PipelinePhaseFunction, PipelinePhaseSingle, PipelinePhaseGroup } from "@/types/pipeline";
import type { RunClaudeOptions } from "@/types/claude";
import type { ManagedOperation } from "./types";
import { emitStatus } from "./events";
import { wireChild } from "./wire-child";
import { buildPhaseFunctionContext } from "./context-builder";
import { runClaude } from "@/lib/claude";
import { resolveModel } from "@/lib/config";
import { Semaphore } from "@/lib/semaphore";

export async function runFunctionPhase(
  managed: ManagedOperation,
  phase: PipelinePhaseFunction,
  operationId: string,
  phaseIndex: number,
  totalPhases: number,
  phaseExtra: { phaseIndex: number; phaseLabel: string },
  appendPhases?: (phases: PipelinePhase[]) => void,
): Promise<boolean> {
  const phaseNum = phaseIndex + 1;
  // Tag with childLabel so the announcement appears inside the phase's frame,
  // grouped together with the phase function's own emitStatus output.
  emitStatus(managed, `Phase ${phaseNum}/${totalPhases}: ${phase.label}`, {
    ...phaseExtra,
    childLabel: phase.label,
  });
  const childId = `${operationId}-phase-${phaseIndex}`;
  (managed.operation.children ??= []).push({ id: childId, label: phase.label, status: "running" });

  let phaseSuccess: boolean;
  try {
    const ctx = buildPhaseFunctionContext(managed, operationId, phaseIndex, phaseExtra, appendPhases);
    phaseSuccess = await phase.fn(ctx);
  } catch (err) {
    if (!managed.abortController.signal.aborted) {
      emitStatus(managed, `Phase ${phaseNum} error: ${err}`, phaseExtra);
    }
    phaseSuccess = false;
  }

  const child = (managed.operation.children ??= []).find((c) => c.id === childId);
  if (child) child.status = phaseSuccess ? "completed" : "failed";
  return phaseSuccess;
}

export async function runSinglePhase(
  managed: ManagedOperation,
  phase: PipelinePhaseSingle,
  operationId: string,
  phaseIndex: number,
  totalPhases: number,
  phaseExtra: { phaseIndex: number; phaseLabel: string },
): Promise<boolean> {
  const phaseNum = phaseIndex + 1;
  emitStatus(managed, `Phase ${phaseNum}/${totalPhases}: ${phase.label}`, phaseExtra);
  const childId = `${operationId}-phase-${phaseIndex}`;
  (managed.operation.children ??= []).push({ id: childId, label: phase.label, status: "running" });
  const model = resolveModel(managed.operation.type, phase.stepType, phase.model);
  const singleOpts: RunClaudeOptions | undefined = (phase.cwd || phase.addDirs || phase.allowedTools || phase.appendSystemPromptFile || model)
    ? { cwd: phase.cwd, addDirs: phase.addDirs, allowedTools: phase.allowedTools, appendSystemPromptFile: phase.appendSystemPromptFile, model }
    : undefined;
  const process = runClaude(childId, phase.prompt, singleOpts);
  const result = await wireChild(managed, childId, phase.label, process, phaseExtra);
  return result.success;
}

export async function runGroupPhase(
  managed: ManagedOperation,
  phase: PipelinePhaseGroup,
  operationId: string,
  phaseIndex: number,
  totalPhases: number,
  phaseExtra: { phaseIndex: number; phaseLabel: string },
): Promise<boolean> {
  const phaseNum = phaseIndex + 1;
  const groupLabel = phase.children.map((c) => c.label).join(", ");
  emitStatus(managed, `Phase ${phaseNum}/${totalPhases}: parallel [${groupLabel}]`, phaseExtra);

  const groupSem = new Semaphore(5);
  const groupPromises = phase.children.map(async (child, j) => {
    return groupSem.run(async () => {
      const childId = `${operationId}-phase-${phaseIndex}-child-${j}`;
      (managed.operation.children ??= []).push({ id: childId, label: child.label, status: "running" });
      const model = resolveModel(managed.operation.type, child.stepType, child.model);
      const claudeOpts: RunClaudeOptions | undefined =
        (child.cwd || child.addDirs || child.allowedTools || child.jsonSchema || child.skipAskUserQuestion || child.appendSystemPromptFile || model)
          ? { cwd: child.cwd, addDirs: child.addDirs, allowedTools: child.allowedTools, jsonSchema: child.jsonSchema, skipAskUserQuestion: child.skipAskUserQuestion, appendSystemPromptFile: child.appendSystemPromptFile, model }
          : undefined;
      const process = runClaude(childId, child.prompt, claudeOpts);
      const result = await wireChild(managed, childId, child.label, process, phaseExtra);
      if (result.resultText && child.onResultText) {
        child.onResultText(result.resultText);
      }
      return result.success;
    });
  });

  const results = await Promise.all(groupPromises);
  emitStatus(
    managed,
    `Phase ${phaseNum} group finished (${results.filter(Boolean).length}/${results.length} succeeded)`,
    phaseExtra,
  );
  return results.every(Boolean);
}
