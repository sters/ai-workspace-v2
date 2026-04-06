import type { Operation, OperationPhaseInfo, OperationType } from "@/types/operation";
import type { PipelinePhase } from "@/types/pipeline";
import type { ManagedOperation } from "./types";
import type { InteractionLevel } from "@/types/prompts";
import { operations } from "./store";
import { getMaxConcurrentOperations } from "./constants";
import { emitStatus } from "./events";
import { gcCompletedOperations } from "./gc";
import { getPhaseLabel } from "./phase-helpers";
import {
  listRunningOperations,
  updateOperationStatus,
  updateOperationMeta,
  startAutoFlush,
} from "@/lib/db";
import { executePipelinePhases } from "./execute-phases";

// ---------------------------------------------------------------------------
// Non-resumable operation types — mark as failed on restart
// ---------------------------------------------------------------------------

const NON_RESUMABLE_TYPES: Set<OperationType> = new Set([
  "delete",
  "workspace-prune",
  "operation-prune",
  "mcp-auth",
  "claude-login",
]);

// ---------------------------------------------------------------------------
// Pipeline rebuilders — reconstruct phases from stored operation data
// ---------------------------------------------------------------------------

async function rebuildPipeline(op: Operation): Promise<PipelinePhase[] | null> {
  const inputs = op.inputs ?? {};
  const workspace = op.workspace;

  try {
    switch (op.type) {
      case "init": {
        const { buildInitPipeline } = await import("@/lib/pipelines/init");
        const bestOfN = inputs.bestOfN ? Number(inputs.bestOfN) : undefined;
        return buildInitPipeline(
          inputs.description ?? "",
          inputs.interactionLevel as InteractionLevel | undefined,
          bestOfN && bestOfN >= 2 ? { bestOfN } : undefined,
        );
      }

      case "execute": {
        const { buildExecutePipeline } = await import("@/lib/pipelines/execute");
        return buildExecutePipeline({
          workspace,
          repository: inputs.repository,
        });
      }

      case "review": {
        const { buildReviewPipeline } = await import("@/lib/pipelines/review");
        return buildReviewPipeline({
          workspace,
          repository: inputs.repository,
        });
      }

      case "create-pr": {
        const { buildCreatePrPipeline } = await import("@/lib/pipelines/create-pr");
        return buildCreatePrPipeline({
          workspace,
          draft: inputs.draft !== "false",
          repository: inputs.repository,
        });
      }

      case "update-todo": {
        const { buildUpdateTodoPipeline } = await import("@/lib/pipelines/update-todo");
        const bestOfN = inputs.bestOfN ? Number(inputs.bestOfN) : undefined;
        return buildUpdateTodoPipeline({
          workspace,
          instruction: inputs.instruction ?? "",
          repo: inputs.repo,
          bestOfN: bestOfN && bestOfN >= 2 ? bestOfN : undefined,
          interactionLevel: inputs.interactionLevel as InteractionLevel | undefined,
        });
      }

      case "create-todo": {
        const { buildCreateTodoPipeline } = await import("@/lib/pipelines/create-todo");
        return buildCreateTodoPipeline(
          workspace,
          inputs.reviewTimestamp ?? "",
          inputs.instruction,
        );
      }

      case "batch": {
        const { buildBatchPipeline } = await import("@/lib/pipelines/batch");
        const bestOfN = inputs.bestOfN ? Number(inputs.bestOfN) : undefined;
        const bestOfNPhases = inputs.bestOfNPhases
          ? (inputs.bestOfNPhases.split(",") as ("execute" | "review" | "create-pr" | "update-todo")[])
          : undefined;
        return buildBatchPipeline({
          mode: inputs.mode as "execute-review" | "execute-pr" | "execute-review-pr-gated" | "execute-review-pr",
          startWith: inputs.startWith as "init" | "update-todo" | "execute",
          description: inputs.description,
          workspace: workspace || undefined,
          instruction: inputs.instruction,
          draft: inputs.draft != null ? inputs.draft !== "false" : undefined,
          interactionLevel: inputs.interactionLevel as InteractionLevel | undefined,
          repo: inputs.repo,
          bestOfN: bestOfN && bestOfN >= 2 ? bestOfN : undefined,
          bestOfNPhases,
        });
      }

      case "autonomous": {
        const { buildAutonomousPipeline } = await import("@/lib/pipelines/autonomous");
        // Count how many cycle phases existed so we pre-generate enough for resume.
        // Cycle phases are those with labels matching "Cycle N".
        const savedPhases = op.phases ?? [];
        const cyclePhaseCount = savedPhases.filter((p) => /^Cycle \d+$/.test(p.label)).length;
        const hasCreatePr = savedPhases.some((p) => p.label === "Create PR");
        return buildAutonomousPipeline({
          startWith: inputs.startWith as "init" | "update-todo" | "execute",
          description: inputs.description,
          workspace: workspace || undefined,
          instruction: inputs.instruction,
          draft: inputs.draft != null ? inputs.draft !== "false" : undefined,
          interactionLevel: inputs.interactionLevel as InteractionLevel | undefined,
          repo: inputs.repo,
          maxLoops: inputs.maxLoops ? Number(inputs.maxLoops) : undefined,
          resumeCycleCount: cyclePhaseCount > 0 ? cyclePhaseCount : undefined,
          resumeWithCreatePr: hasCreatePr,
        });
      }

      case "search": {
        const { buildSearchPipeline } = await import("@/lib/pipelines/search");
        return buildSearchPipeline(inputs.query ?? "");
      }

      default:
        return null;
    }
  } catch (err) {
    console.warn(`[resume] Failed to rebuild pipeline for ${op.type}/${op.id}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resume a single operation from a specific phase
// ---------------------------------------------------------------------------

function resumeOperationPipeline(
  existingOp: Operation,
  phases: PipelinePhase[],
  resumeFromPhase: number,
): void {
  gcCompletedOperations();

  // Enforce concurrency limit
  let running = 0;
  for (const managed of operations.values()) {
    if (managed.operation.status === "running") running++;
  }
  if (running >= getMaxConcurrentOperations()) {
    console.warn(`[resume] Concurrency limit reached, marking ${existingOp.id} as failed`);
    updateOperationStatus(existingOp.id, "failed", new Date().toISOString());
    return;
  }

  // Build phase info array for the new pipeline
  const phaseInfos: OperationPhaseInfo[] = phases.map((phase, i) => ({
    index: i,
    label: getPhaseLabel(phase, i),
    status: i < resumeFromPhase ? "completed" as const : "pending" as const,
  }));

  // Update operation in memory
  existingOp.status = "running";
  existingOp.children = [];
  existingOp.phases = phaseInfos;

  // Update phases in DB
  updateOperationMeta(existingOp.id, { phases: phaseInfos });

  const managed: ManagedOperation = {
    operation: existingOp,
    claudeProcess: null,
    childProcesses: new Map(),
    events: [],
    listeners: new Set(),
    pendingAsks: new Map(),
    hasPendingAsk: false,
    abortController: new AbortController(),
  };

  startAutoFlush(existingOp.id);
  operations.set(existingOp.id, managed);
  emitStatus(managed, `Resuming pipeline from phase ${resumeFromPhase + 1}/${phases.length}`);

  // WARNING: Resume does not guarantee idempotency for partially-completed phases.
  // If a phase was "running" when the server crashed (e.g., a function phase that
  // partially completed work like creating git branches or worktrees), it will be
  // re-run from scratch. The rebuilt pipeline creates fresh phases, so side effects
  // from the original run (like already-created worktree branches) could cause
  // failures or duplicate resources. Each phase's function should ideally include
  // its own idempotency checks (e.g., checking if a worktree already exists before
  // creating one), but this is not enforced by the pipeline framework.
  // Note: Resumed pipelines do not restore PipelineOptions.onPhaseComplete callbacks.
  // This is acceptable because batch/autonomous pipelines use inline closure
  // variables (e.g., skipPr) rather than onPhaseComplete for gate logic, and the
  // rebuilt pipeline creates fresh closure state that works correctly.
  executePipelinePhases({
    managed,
    phases,
    phaseInfos,
    operationType: existingOp.type,
    startFromPhase: resumeFromPhase,
  });
}

// ---------------------------------------------------------------------------
// Entry point: find and resume all stale running operations
// ---------------------------------------------------------------------------

export async function resumeStaleOperations(): Promise<void> {
  const stale = listRunningOperations();
  if (stale.length === 0) return;

  console.log(`[resume] Found ${stale.length} interrupted operation(s)`);

  for (const op of stale) {
    // Skip non-resumable types
    if (NON_RESUMABLE_TYPES.has(op.type)) {
      console.log(`[resume] Marking ${op.type}/${op.id} as failed (non-resumable type)`);
      updateOperationStatus(op.id, "failed", new Date().toISOString());
      continue;
    }

    // Determine resume point from saved phases
    const savedPhases = op.phases ?? [];
    let resumeFrom = 0;
    for (let i = 0; i < savedPhases.length; i++) {
      if (savedPhases[i].status === "completed") {
        resumeFrom = i + 1;
      } else {
        break;
      }
    }

    // If all phases completed, just mark as completed
    if (savedPhases.length > 0 && resumeFrom >= savedPhases.length) {
      console.log(`[resume] All phases completed for ${op.type}/${op.id}, marking as completed`);
      updateOperationStatus(op.id, "completed", new Date().toISOString());
      continue;
    }

    // Rebuild pipeline
    const phases = await rebuildPipeline(op);
    if (!phases) {
      console.log(`[resume] Cannot rebuild pipeline for ${op.type}/${op.id}, marking as failed`);
      updateOperationStatus(op.id, "failed", new Date().toISOString());
      continue;
    }

    // Validate phase count — rebuilt pipeline should have at least resumeFrom phases
    if (resumeFrom > phases.length) {
      console.log(`[resume] Phase count mismatch for ${op.type}/${op.id} (saved: ${savedPhases.length}, rebuilt: ${phases.length}), marking as failed`);
      updateOperationStatus(op.id, "failed", new Date().toISOString());
      continue;
    }

    console.log(`[resume] Resuming ${op.type}/${op.id} from phase ${resumeFrom + 1}/${phases.length}`);
    resumeOperationPipeline(op, phases, resumeFrom);
  }
}
