import type { Operation, OperationPhaseInfo, OperationType } from "@/types/operation";
import type { PipelinePhase, PipelineOptions } from "@/types/pipeline";
import type { ManagedOperation } from "./types";
import { operations, nextId } from "./store";
import { getMaxConcurrentOperations, ConcurrencyLimitError } from "./constants";
import { emitStatus } from "./events";
import { gcCompletedOperations } from "./gc";
import { getPhaseLabel } from "./phase-helpers";
import { insertOperation, startAutoFlush } from "@/lib/db";
import { executePipelinePhases } from "./execute-phases";

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
  if (running >= getMaxConcurrentOperations()) {
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

  executePipelinePhases({
    managed,
    phases,
    phaseInfos,
    operationType: type,
    pipelineOptions,
  });

  return operation;
}
