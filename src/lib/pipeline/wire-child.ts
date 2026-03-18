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
