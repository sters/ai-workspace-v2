import type { ClaudeProcess } from "@/types/claude";
import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation, WireChildResult } from "./types";
import { emitEvent, emitStatus } from "./events";

/**
 * Wire a child ClaudeProcess to the parent ManagedOperation.
 * Tags every event with childLabel (and optional phaseExtra) and updates child status on completion.
 */
export function wireChild(
  managed: ManagedOperation,
  childId: string,
  childLabel: string,
  process: ClaudeProcess,
  phaseExtra?: { phaseIndex?: number; phaseLabel?: string },
): Promise<WireChildResult> {
  managed.childProcesses.set(childId, {
    process,
    childLabel,
    phaseIndex: phaseExtra?.phaseIndex,
    phaseLabel: phaseExtra?.phaseLabel,
  });
  emitStatus(managed, "Initializing...", { childLabel, ...phaseExtra });

  // Fix 6: If the ClaudeProcess supports process tracking (CLI backend),
  // register a callback so that when submitAnswer spawns a new subprocess,
  // the childProcesses entry stays current. This ensures the timeout handler
  // can find and kill the resumed process.
  if ("onProcessSpawned" in process && typeof process.onProcessSpawned === "function") {
    // The ClaudeProcess wrapper's kill() already uses the closure variable
    // currentProc, so the entry in childProcesses doesn't need updating for
    // kill to work. However, registering the callback ensures any future
    // tracking code that accesses the raw subprocess will have the right ref.
    (process as ClaudeProcess & { onProcessSpawned: (cb: (p: unknown) => void) => void })
      .onProcessSpawned(() => {
        // Re-register the entry so it's visible for any future lookups.
        // The ClaudeProcess wrapper itself hasn't changed, just the internal subprocess.
        if (!managed.childProcesses.has(childId)) {
          managed.childProcesses.set(childId, {
            process,
            childLabel,
            phaseIndex: phaseExtra?.phaseIndex,
            phaseLabel: phaseExtra?.phaseLabel,
          });
        }
      });
  }

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
        // Fix 9: Wrap JSON.parse in try/catch so a single malformed event
        // doesn't crash the entire operation.
        let success = false;
        try {
          const data = JSON.parse(event.data);
          success = data.exitCode === 0;
        } catch (err) {
          console.warn(`[wire-child] Failed to parse complete event data for ${childId}:`, err);
          success = false;
        }
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
