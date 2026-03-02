import type {
  Operation,
  OperationEvent,
  OperationPhaseInfo,
  OperationType,
} from "@/types/operation";
import type { PipelinePhase, PipelineOptions } from "@/types/pipeline";
import { runClaude } from "./claude";
import type { ClaudeProcess, RunClaudeOptions } from "@/types/claude";
import { Semaphore } from "./semaphore";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManagedOperation {
  operation: Operation;
  claudeProcess: ClaudeProcess | null;
  childProcesses: Map<string, ClaudeProcess>;
  events: OperationEvent[];
  listeners: Set<(event: OperationEvent) => void>;
  /** Pending ask resolvers for function-phase emitAsk calls, keyed by toolUseId. */
  pendingAsks: Map<string, (answers: Record<string, string>) => void>;
  /** Abort controller for cancelling function-phase work (e.g. PTY processes). */
  abortController: AbortController;
  /** Timestamp (ms) when the operation completed. Used for GC. */
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Concurrency limits
// ---------------------------------------------------------------------------

export const MAX_CONCURRENT_OPERATIONS = 3;

export class ConcurrencyLimitError extends Error {
  constructor(running: number) {
    super(`Too many concurrent operations (${running}/${MAX_CONCURRENT_OPERATIONS}). Try again later.`);
    this.name = "ConcurrencyLimitError";
  }
}

// ---------------------------------------------------------------------------
// Phase timeout defaults
// ---------------------------------------------------------------------------

/** Default timeout for Claude execution phases (single/group): 20 minutes. */
export const DEFAULT_CLAUDE_TIMEOUT_MS = 20 * 60 * 1000;
/** Default timeout for function phases: 3 minutes. */
export const DEFAULT_FUNCTION_TIMEOUT_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// Global store (survives HMR in dev mode)
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as {
  __aiWorkspaceOps?: Map<string, ManagedOperation>;
  __aiWorkspaceCounter?: number;
};

if (!globalStore.__aiWorkspaceOps) {
  globalStore.__aiWorkspaceOps = new Map();
}
if (globalStore.__aiWorkspaceCounter == null) {
  globalStore.__aiWorkspaceCounter = 0;
}

const operations = globalStore.__aiWorkspaceOps;

function nextId(prefix: string): string {
  return `${prefix}-${++globalStore.__aiWorkspaceCounter!}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function emitEvent(managed: ManagedOperation, event: OperationEvent) {
  managed.events.push(event);
  if (managed.events.length > 5000) {
    managed.events = managed.events.slice(-3000);
  }
  for (const listener of managed.listeners) {
    listener(event);
  }
}

function emitStatus(
  managed: ManagedOperation,
  message: string,
  extra?: { childLabel?: string; phaseIndex?: number; phaseLabel?: string },
) {
  emitEvent(managed, {
    type: "status",
    operationId: managed.operation.id,
    data: message,
    timestamp: new Date().toISOString(),
    childLabel: extra?.childLabel,
    phaseIndex: extra?.phaseIndex,
    phaseLabel: extra?.phaseLabel,
  });
}

function markComplete(managed: ManagedOperation, success: boolean) {
  if (managed.operation.status !== "running") return;
  managed.operation.status = success ? "completed" : "failed";
  managed.operation.completedAt = new Date().toISOString();
  managed.completedAt = Date.now();

  // Emit the complete event BEFORE clearing listeners so SSE clients receive it
  emitEvent(managed, {
    type: "complete",
    operationId: managed.operation.id,
    data: JSON.stringify({ exitCode: success ? 0 : 1 }),
    timestamp: new Date().toISOString(),
  });

  // Release references to help GC
  managed.childProcesses.clear();
  managed.pendingAsks.clear();
  managed.listeners.clear();
  managed.claudeProcess = null;
}

// ---------------------------------------------------------------------------
// GC — clean up completed operations to prevent memory leaks
// ---------------------------------------------------------------------------

/** Max age in ms for completed operations before GC (30 minutes). */
const GC_MAX_AGE_MS = 30 * 60 * 1000;
/** Max number of completed operations to keep. */
const GC_MAX_COMPLETED = 50;

/** Exported for testing. */
export const _gc = { GC_MAX_AGE_MS, GC_MAX_COMPLETED };

function gcCompletedOperations() {
  const now = Date.now();
  const completed: [string, ManagedOperation][] = [];

  for (const [id, managed] of operations) {
    if (managed.completedAt != null) {
      // Remove operations older than GC_MAX_AGE_MS
      if (now - managed.completedAt > GC_MAX_AGE_MS) {
        operations.delete(id);
      } else {
        completed.push([id, managed]);
      }
    }
  }

  // If still too many completed operations, remove oldest
  if (completed.length > GC_MAX_COMPLETED) {
    completed.sort((a, b) => (a[1].completedAt ?? 0) - (b[1].completedAt ?? 0));
    const toRemove = completed.length - GC_MAX_COMPLETED;
    for (let i = 0; i < toRemove; i++) {
      operations.delete(completed[i][0]);
    }
  }
}

interface WireChildResult {
  success: boolean;
  resultText?: string;
}

/**
 * Wire a child ClaudeProcess to the parent ManagedOperation.
 * Tags every event with childLabel (and optional phaseExtra) and updates child status on completion.
 */
function wireChild(
  managed: ManagedOperation,
  childId: string,
  childLabel: string,
  process: ClaudeProcess,
  phaseExtra?: { phaseIndex?: number; phaseLabel?: string },
): Promise<WireChildResult> {
  managed.childProcesses.set(childId, process);
  emitStatus(managed, "Initializing...", { childLabel, ...phaseExtra });

  return new Promise<WireChildResult>((resolve) => {
    let resolved = false;

    process.onEvent((event) => {
      const tagged: OperationEvent = {
        ...event,
        operationId: managed.operation.id,
        childLabel,
        ...phaseExtra,
      };
      emitEvent(managed, tagged);

      if (event.type === "complete") {
        if (resolved) return;
        resolved = true;
        const data = JSON.parse(event.data);
        const success = data.exitCode === 0;
        const child = managed.operation.children?.find((c) => c.id === childId);
        if (child) child.status = success ? "completed" : "failed";
        managed.childProcesses.delete(childId);
        resolve({ success, resultText: process.getResultText() });
      }
    });

    // If the operation is cancelled, resolve immediately as failed
    const signal = managed.abortController.signal;
    const onAbort = () => {
      if (resolved) return;
      resolved = true;
      const child = managed.operation.children?.find((c) => c.id === childId);
      if (child) child.status = "failed";
      managed.childProcesses.delete(childId);
      resolve({ success: false, resultText: undefined });
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Helper to derive a label for a pipeline phase. */
function getPhaseLabel(phase: PipelinePhase, index: number): string {
  if (phase.kind === "single" || phase.kind === "function") return phase.label;
  return `Phase ${index + 1}: ${phase.children.map((c) => c.label).join(", ")}`;
}

/** Emit a __phaseUpdate status event so the client can track phase lifecycle. */
function emitPhaseUpdate(
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

// ---------------------------------------------------------------------------
// startOperationPipeline — sequential phases (the single entry point)
// ---------------------------------------------------------------------------

export function startOperationPipeline(
  type: OperationType,
  workspace: string,
  phases: PipelinePhase[],
  pipelineOptions?: PipelineOptions,
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

  const id = nextId("pipe");

  // Build phase info array
  const phaseInfos: OperationPhaseInfo[] = phases.map((phase, i) => ({
    index: i,
    label: getPhaseLabel(phase, i),
    status: "pending" as const,
  }));

  const operation: Operation = {
    id,
    type,
    workspace,
    status: "running",
    startedAt: new Date().toISOString(),
    children: [],
    phases: phaseInfos,
  };

  const managed: ManagedOperation = {
    operation,
    claudeProcess: null,
    childProcesses: new Map(),
    events: [],
    listeners: new Set(),
    pendingAsks: new Map(),
    abortController: new AbortController(),
  };

  operations.set(id, managed);
  emitStatus(managed, `Starting pipeline with ${phases.length} phases`);

  (async () => {
    let pipelineSuccess = true;

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

      // Determine timeout for this phase
      const defaultTimeout = phase.kind === "function"
        ? DEFAULT_FUNCTION_TIMEOUT_MS
        : DEFAULT_CLAUDE_TIMEOUT_MS;
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
        for (const [, proc] of managed.childProcesses) {
          proc.kill();
        }
      }, timeoutMs);

      if (phase.kind === "function") {
        emitStatus(managed, `Phase ${phaseNum}/${phases.length}: ${phase.label}`, phaseExtra);
        const childId = `${id}-phase-${i}`;
        operation.children!.push({ id: childId, label: phase.label, status: "running" });

        let childCounter = 0;
        try {
          phaseSuccess = await phase.fn({
            operationId: id,
            emitStatus: (msg) => emitStatus(managed, msg, phaseExtra),
            emitResult: (msg) => {
              emitEvent(managed, {
                type: "output",
                operationId: managed.operation.id,
                data: JSON.stringify({ type: "result", subtype: "success", result: msg }),
                timestamp: new Date().toISOString(),
                ...phaseExtra,
              });
            },
            setWorkspace: (ws) => {
              managed.operation.workspace = ws;
              emitStatus(managed, `__setWorkspace:${ws}`, phaseExtra);
            },
            emitAsk: (questions) => {
              const toolUseId = `fn-ask-${id}-${i}-${childCounter++}`;
              // Emit an ask event that the UI will render
              emitEvent(managed, {
                type: "output",
                operationId: managed.operation.id,
                data: JSON.stringify({
                  type: "assistant",
                  message: {
                    content: [{
                      type: "tool_use",
                      id: toolUseId,
                      name: "AskUserQuestion",
                      input: {
                        questions: questions.map((q) => ({
                          question: q.question,
                          options: q.options,
                          multiSelect: q.multiSelect ?? false,
                        })),
                      },
                    }],
                  },
                }),
                timestamp: new Date().toISOString(),
                ...phaseExtra,
              });
              // Return a promise that resolves when the user answers
              // or rejects when the operation is cancelled
              return new Promise<Record<string, string>>((resolve, reject) => {
                const signal = managed.abortController.signal;
                if (signal.aborted) {
                  managed.pendingAsks.delete(toolUseId);
                  reject(new DOMException("Operation cancelled", "AbortError"));
                  return;
                }
                const onAbort = () => {
                  managed.pendingAsks.delete(toolUseId);
                  reject(new DOMException("Operation cancelled", "AbortError"));
                };
                signal.addEventListener("abort", onAbort, { once: true });
                managed.pendingAsks.set(toolUseId, (answers) => {
                  signal.removeEventListener("abort", onAbort);
                  // Emit a tool_result event so findPendingAsk marks it answered
                  emitEvent(managed, {
                    type: "output",
                    operationId: managed.operation.id,
                    data: JSON.stringify({
                      type: "user",
                      message: {
                        content: [{
                          type: "tool_result",
                          tool_use_id: toolUseId,
                          content: Object.values(answers).join(", "),
                        }],
                      },
                    }),
                    timestamp: new Date().toISOString(),
                    ...phaseExtra,
                  });
                  resolve(answers);
                });
              });
            },
            runChild: async (label, prompt, childOptions) => {
              const cid = `${id}-phase-${i}-fn-${childCounter++}`;
              operation.children!.push({ id: cid, label, status: "running" });
              const claudeOpts: RunClaudeOptions | undefined = childOptions?.jsonSchema
                ? { jsonSchema: childOptions.jsonSchema }
                : undefined;
              const proc = runClaude(cid, prompt, claudeOpts);
              const result = await wireChild(managed, cid, label, proc, phaseExtra);
              if (result.resultText && childOptions?.onResultText) {
                childOptions.onResultText(result.resultText);
              }
              return result.success;
            },
            emitTerminal: (data) => {
              emitEvent(managed, {
                type: "terminal",
                operationId: managed.operation.id,
                data,
                timestamp: new Date().toISOString(),
                ...phaseExtra,
              });
            },
            signal: managed.abortController.signal,
            runChildGroup: (children) => {
              const sem = new Semaphore(5);
              const promises = children.map(async (child) => {
                return sem.run(async () => {
                  const cid = `${id}-phase-${i}-fn-${childCounter++}`;
                  operation.children!.push({ id: cid, label: child.label, status: "running" });
                  const proc = runClaude(cid, child.prompt);
                  const result = await wireChild(managed, cid, child.label, proc, phaseExtra);
                  return result.success;
                });
              });
              return Promise.all(promises);
            },
          });
        } catch (err) {
          if (timedOut) {
            phaseSuccess = false;
          } else if (managed.abortController.signal.aborted) {
            phaseSuccess = false;
          } else {
            emitStatus(managed, `Phase ${phaseNum} error: ${err}`, phaseExtra);
            phaseSuccess = false;
          }
        }

        const child = operation.children!.find((c) => c.id === childId);
        if (child) child.status = phaseSuccess ? "completed" : "failed";

      } else if (phase.kind === "single") {
        emitStatus(managed, `Phase ${phaseNum}/${phases.length}: ${phase.label}`, phaseExtra);
        const childId = `${id}-phase-${i}`;
        operation.children!.push({ id: childId, label: phase.label, status: "running" });
        const process = runClaude(childId, phase.prompt);
        const result = await wireChild(managed, childId, phase.label, process, phaseExtra);
        phaseSuccess = result.success;

      } else {
        // group
        const groupLabel = phase.children.map((c) => c.label).join(", ");
        emitStatus(managed, `Phase ${phaseNum}/${phases.length}: parallel [${groupLabel}]`, phaseExtra);

        const groupSem = new Semaphore(5);
        const groupPromises = phase.children.map(async (child, j) => {
          return groupSem.run(async () => {
            const childId = `${id}-phase-${i}-child-${j}`;
            operation.children!.push({ id: childId, label: child.label, status: "running" });
            const process = runClaude(childId, child.prompt);
            const result = await wireChild(managed, childId, child.label, process, phaseExtra);
            return result.success;
          });
        });

        const results = await Promise.all(groupPromises);
        phaseSuccess = results.every(Boolean);
        emitStatus(
          managed,
          `Phase ${phaseNum} group finished (${results.filter(Boolean).length}/${results.length} succeeded)`,
          phaseExtra,
        );
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

    markComplete(managed, pipelineSuccess);
  })();

  return operation;
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

export function getOperations(): Operation[] {
  gcCompletedOperations();
  return Array.from(operations.values()).map((m) => m.operation);
}

export function getOperation(id: string): Operation | undefined {
  return operations.get(id)?.operation;
}

export function getOperationEvents(id: string): OperationEvent[] {
  return operations.get(id)?.events ?? [];
}

export function subscribeToOperation(
  id: string,
  listener: (event: OperationEvent) => void,
): () => void {
  const managed = operations.get(id);
  if (!managed) return () => {};
  managed.listeners.add(listener);
  return () => managed.listeners.delete(listener);
}

export function deleteOperation(id: string): boolean {
  const managed = operations.get(id);
  if (!managed) return false;
  // Only allow deleting completed/failed operations
  if (managed.operation.status === "running") return false;
  operations.delete(id);
  return true;
}

export function killOperation(id: string): boolean {
  const managed = operations.get(id);
  if (!managed || managed.operation.status !== "running") return false;
  managed.abortController.abort();
  if (managed.claudeProcess) managed.claudeProcess.kill();
  for (const [, process] of managed.childProcesses) process.kill();
  return true;
}

export function submitAnswer(
  id: string,
  toolUseId: string,
  answers: Record<string, string>,
): boolean {
  const managed = operations.get(id);
  if (!managed || managed.operation.status !== "running") return false;
  // Check function-phase pending asks first
  const pendingResolver = managed.pendingAsks.get(toolUseId);
  if (pendingResolver) {
    managed.pendingAsks.delete(toolUseId);
    pendingResolver(answers);
    return true;
  }
  if (managed.claudeProcess?.submitAnswer(toolUseId, answers)) return true;
  for (const [, process] of managed.childProcesses) {
    if (process.submitAnswer(toolUseId, answers)) return true;
  }
  return false;
}
