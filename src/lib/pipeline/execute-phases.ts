import type { OperationPhaseInfo, OperationType } from "@/types/operation";
import type { PipelinePhase, PipelineOptions } from "@/types/pipeline";
import type { ManagedOperation } from "./types";
import { getTimeoutDefaults } from "./constants";
import { emitStatus, markComplete } from "./events";
import { emitPhaseUpdate } from "./phase-helpers";
import { runFunctionPhase, runSinglePhase, runGroupPhase } from "./phase-runners";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 3000;

/** Sleep for `ms` milliseconds, resolving early if `signal` fires. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export interface ExecutePhasesParams {
  managed: ManagedOperation;
  phases: PipelinePhase[];
  phaseInfos: OperationPhaseInfo[];
  operationType: OperationType;
  startFromPhase?: number;
  pipelineOptions?: PipelineOptions;
}

/**
 * Shared pipeline execution loop used by both startOperationPipeline and
 * resumeOperationPipeline. Runs phases sequentially, handling timeouts,
 * abort signals, onPhaseComplete callbacks, and the try/finally with
 * markComplete.
 */
export async function executePipelinePhases(params: ExecutePhasesParams): Promise<void> {
  const {
    managed,
    phases,
    phaseInfos,
    operationType,
    startFromPhase = 0,
    pipelineOptions,
  } = params;

  const operationId = managed.operation.id;
  let pipelineSuccess = true;

  try {
    for (let i = startFromPhase; i < phases.length; i++) {
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

      // Retry configuration
      const maxRetries = phase.maxRetries ?? DEFAULT_MAX_RETRIES;
      const retryDelayMs = phase.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
      let attempt = 0;
      let phaseSuccess = false;

      // Store maxRetries on phaseInfo for UI visibility
      if (phaseInfos[i] && maxRetries > 0) {
        phaseInfos[i].maxRetries = maxRetries;
      }

      // Retry loop: run the phase up to (1 + maxRetries) times
      do {
        // On retry: emit retrying status and wait
        if (attempt > 0) {
          const retryInfo = { retryAttempt: attempt, maxRetries };
          emitPhaseUpdate(managed, i, phaseLabel, "retrying", retryInfo);
          emitStatus(managed, `Phase ${phaseNum} retry ${attempt}/${maxRetries} after ${retryDelayMs}ms delay`, phaseExtra);

          await delay(retryDelayMs, managed.abortController.signal);
          if (managed.abortController.signal.aborted) break;

          // Reset start time for the new attempt
          if (phaseInfos[i]) {
            phaseInfos[i].startedAt = new Date().toISOString();
            phaseInfos[i].retryAttempt = attempt;
          }
        }

        // Determine timeout for this phase (per-type overrides > global defaults)
        const timeouts = getTimeoutDefaults(operationType);
        const defaultTimeout = phase.kind === "function"
          ? timeouts.functionMs
          : timeouts.claudeMs;
        const timeoutMs = phase.timeoutMs ?? defaultTimeout;

        // Store timeout and start time on the phase info before emitting the update
        if (phaseInfos[i]) {
          phaseInfos[i].timeoutMs = timeoutMs;
          if (attempt === 0) {
            phaseInfos[i].startedAt = new Date().toISOString();
          }
        }

        const retryInfo = attempt > 0 ? { retryAttempt: attempt, maxRetries } : undefined;
        emitPhaseUpdate(managed, i, phaseLabel, "running", retryInfo);

        // Set up timeout timer.
        // For function phases, use a per-phase AbortController so that a timeout
        // doesn't permanently abort the shared managed.abortController (Fix 3).
        let timedOut = false;
        const phaseAbortController = phase.kind === "function"
          ? new AbortController()
          : undefined;

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          emitStatus(managed, `Phase ${phaseNum} timed out after ${timeoutMs}ms`, phaseExtra);
          // Abort function phases via a per-phase abort controller
          if (phase.kind === "function" && phaseAbortController) {
            phaseAbortController.abort();
          }
          // Kill all child processes for single/group phases.
          // ClaudeProcess.kill() sends SIGTERM and internally schedules
          // SIGKILL after 5 seconds, so no additional fallback is needed.
          for (const [, entry] of managed.childProcesses) {
            try { entry.process.kill(); } catch { /* already exited */ }
          }
        }, timeoutMs);

        // For function phases, swap the abort signal temporarily so the phase
        // sees a per-phase signal that only fires on timeout, not permanently.
        // The managed abort controller still fires for user-initiated kills.
        const originalAbortController = managed.abortController;
        if (phase.kind === "function" && phaseAbortController) {
          // Create a combined controller: aborts if either the managed controller
          // (user kill) or the phase controller (timeout) fires.
          const combinedController = new AbortController();
          const abortCombined = () => combinedController.abort();
          if (originalAbortController.signal.aborted) {
            combinedController.abort();
          } else {
            originalAbortController.signal.addEventListener("abort", abortCombined, { once: true });
            phaseAbortController.signal.addEventListener("abort", abortCombined, { once: true });
          }
          // Temporarily replace the abort controller so runFunctionPhase sees the combined signal
          managed.abortController = combinedController;
        }

        if (phase.kind === "function") {
          phaseSuccess = await runFunctionPhase(managed, phase, operationId, i, phases.length, phaseExtra);
        } else if (phase.kind === "single") {
          phaseSuccess = await runSinglePhase(managed, phase, operationId, i, phases.length, phaseExtra);
        } else {
          phaseSuccess = await runGroupPhase(managed, phase, operationId, i, phases.length, phaseExtra);
        }

        // Restore original abort controller after function phase completes
        if (phase.kind === "function" && phaseAbortController) {
          managed.abortController = originalAbortController;
        }

        clearTimeout(timeoutTimer);
        if (timedOut) phaseSuccess = false;

        if (phaseSuccess) break; // Success — no need to retry

        attempt++;
      } while (attempt <= maxRetries && !managed.abortController.signal.aborted);

      const finalRetryInfo = (maxRetries > 0 && attempt > 0)
        ? { retryAttempt: Math.min(attempt, maxRetries), maxRetries }
        : undefined;
      emitPhaseUpdate(managed, i, phaseLabel, phaseSuccess ? "completed" : "failed", finalRetryInfo);

      // Fix 4: Check phaseSuccess BEFORE calling onPhaseComplete.
      // If the phase failed, break regardless of what onPhaseComplete returns.
      if (!phaseSuccess) {
        if (pipelineOptions?.onPhaseComplete) {
          // Allow onPhaseComplete to see the failure, but only "abort" or "continue" are meaningful
          const action = pipelineOptions.onPhaseComplete(i, phase, phaseSuccess);
          if (action === "abort" || action !== "continue") {
            emitStatus(managed, `Phase ${phaseNum} failed, aborting pipeline`, phaseExtra);
            pipelineSuccess = false;
            break;
          }
          // action === "continue": caller explicitly wants to continue past failure
          continue;
        }
        emitStatus(managed, `Phase ${phaseNum} failed, aborting pipeline`, phaseExtra);
        pipelineSuccess = false;
        break;
      }

      if (pipelineOptions?.onPhaseComplete) {
        const action = pipelineOptions.onPhaseComplete(i, phase, phaseSuccess);
        if (action === "abort") {
          emitStatus(managed, `Pipeline aborted after phase ${phaseNum}`, phaseExtra);
          pipelineSuccess = false;
          break;
        }
        if (action === "skip") {
          // Skip the NEXT phase (i+1). Guard against out-of-bounds.
          if (i + 1 < phases.length) {
            emitPhaseUpdate(managed, i + 1, phaseInfos[i + 1]?.label ?? "", "skipped");
            emitStatus(managed, `Skipping phase ${phaseNum + 1}`, phaseExtra);
            // Advance i so the loop increment brings us past the skipped phase.
            // The for-loop will do i++ at the end of this iteration, so after
            // setting i = i + 1 here, the next iteration will be i + 2.
            i++;
          }
          continue;
        }
      }
    }
  } catch (err) {
    emitStatus(managed, `Pipeline error: ${err}`);
    pipelineSuccess = false;
  } finally {
    markComplete(managed, pipelineSuccess);
  }
}
