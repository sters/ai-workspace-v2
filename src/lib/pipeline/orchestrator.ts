import type { Operation, OperationPhaseInfo, OperationType } from "@/types/operation";
import type { PipelinePhase, PipelineOptions } from "@/types/pipeline";
import type { ManagedOperation } from "./types";
import { operations, nextId } from "./store";
import { MAX_CONCURRENT_OPERATIONS, ConcurrencyLimitError, getTimeoutDefaults } from "./constants";
import { emitStatus, markComplete } from "./events";
import { gcCompletedOperations } from "./gc";
import { getPhaseLabel, emitPhaseUpdate } from "./phase-helpers";
import { runFunctionPhase, runSinglePhase, runGroupPhase } from "./phase-runners";
import { insertOperation, startAutoFlush } from "@/lib/db";

export function startOperationPipeline(
  type: OperationType,
  workspace: string,
  phases: PipelinePhase[],
  pipelineOptions?: PipelineOptions,
  inputs?: Record<string, string>,
): Operation {
  gcCompletedOperations();

  // Enforce concurrency limit
  let running = 0;
  for (const managed of operations.values()) {
    if (managed.operation.status === "running") running++;
  }
  if (running >= MAX_CONCURRENT_OPERATIONS) {
    throw new ConcurrencyLimitError(running);
  }

  const id = nextId();

  // Build phase info array
  const phaseInfos: OperationPhaseInfo[] = phases.map((phase, i) => ({
    index: i,
    label: getPhaseLabel(phase, i),
    status: "pending" as const,
  }));

  // Filter out empty/internal fields to keep only meaningful user inputs
  const filteredInputs = inputs
    ? Object.fromEntries(
        Object.entries(inputs).filter(([, v]) => v != null && v !== ""),
      )
    : undefined;

  const operation: Operation = {
    id,
    type,
    workspace,
    status: "running",
    startedAt: new Date().toISOString(),
    children: [],
    phases: phaseInfos,
    ...(filteredInputs && Object.keys(filteredInputs).length > 0 && { inputs: filteredInputs }),
  };

  const managed: ManagedOperation = {
    operation,
    claudeProcess: null,
    childProcesses: new Map(),
    events: [],
    listeners: new Set(),
    pendingAsks: new Map(),
    hasPendingAsk: false,
    abortController: new AbortController(),
  };

  // Persist to SQLite first — if this fails, no memory orphan
  insertOperation(operation);
  startAutoFlush(id);

  operations.set(id, managed);
  emitStatus(managed, `Starting pipeline with ${phases.length} phases`);

  (async () => {
    let pipelineSuccess = true;

    try {
    for (let i = 0; i < phases.length; i++) {
      // Check if the operation was cancelled between phases
      if (managed.abortController.signal.aborted) {
        emitStatus(managed, "Operation cancelled");
        pipelineSuccess = false;
        // Mark remaining phases as skipped
        for (let j = i; j < phases.length; j++) {
          emitPhaseUpdate(managed, j, phaseInfos[j].label, "skipped");
        }
        break;
      }

      const phase = phases[i];
      const phaseNum = i + 1;
      const phaseLabel = phaseInfos[i].label;
      const phaseExtra = { phaseIndex: i, phaseLabel };
      let phaseSuccess: boolean;

      // Determine timeout for this phase (per-type overrides > global defaults)
      const timeouts = getTimeoutDefaults(type);
      const defaultTimeout = phase.kind === "function"
        ? timeouts.functionMs
        : timeouts.claudeMs;
      const timeoutMs = phase.timeoutMs ?? defaultTimeout;

      // Store timeout and start time on the phase info before emitting the update
      if (phaseInfos[i]) {
        phaseInfos[i].timeoutMs = timeoutMs;
        phaseInfos[i].startedAt = new Date().toISOString();
      }

      emitPhaseUpdate(managed, i, phaseLabel, "running");

      // Set up timeout timer
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        emitStatus(managed, `Phase ${phaseNum} timed out after ${timeoutMs}ms`, phaseExtra);
        // Abort function phases via the abort controller
        if (phase.kind === "function") {
          managed.abortController.abort();
        }
        // Kill all child processes for single/group phases
        for (const [, entry] of managed.childProcesses) {
          entry.process.kill();
        }
      }, timeoutMs);

      if (phase.kind === "function") {
        phaseSuccess = await runFunctionPhase(managed, phase, id, i, phases.length, phaseExtra);
      } else if (phase.kind === "single") {
        phaseSuccess = await runSinglePhase(managed, phase, id, i, phases.length, phaseExtra);
      } else {
        phaseSuccess = await runGroupPhase(managed, phase, id, i, phases.length, phaseExtra);
      }

      clearTimeout(timeoutTimer);
      if (timedOut) phaseSuccess = false;

      emitPhaseUpdate(managed, i, phaseLabel, phaseSuccess ? "completed" : "failed");

      if (pipelineOptions?.onPhaseComplete) {
        const action = pipelineOptions.onPhaseComplete(i, phase, phaseSuccess);
        if (action === "abort") {
          emitStatus(managed, `Pipeline aborted after phase ${phaseNum}`, phaseExtra);
          pipelineSuccess = false;
          break;
        }
        if (action === "skip") {
          emitPhaseUpdate(managed, i + 1, phaseInfos[i + 1]?.label ?? "", "skipped");
          emitStatus(managed, `Skipping phase ${phaseNum + 1}`, phaseExtra);
          i++;
          continue;
        }
      }

      if (!phaseSuccess) {
        emitStatus(managed, `Phase ${phaseNum} failed, aborting pipeline`, phaseExtra);
        pipelineSuccess = false;
        break;
      }
    }
    } catch (err) {
      emitStatus(managed, `Pipeline error: ${err}`);
      pipelineSuccess = false;
    } finally {
      markComplete(managed, pipelineSuccess);
    }
  })();

  return operation;
}
