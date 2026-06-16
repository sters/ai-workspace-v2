import type { ClaudeProcess } from "@/types/claude";
import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation, WireChildResult } from "./types";
import { emitEvent, emitStatus } from "./events";

/**
 * Recompute managed.hasPendingAsk from the event stream, mirroring the client's
 * findPendingAsk() in src/components/operation/log/display-nodes.ts: a pending
 * ask exists only if some AskUserQuestion tool_use has no matching tool_result
 * AND its emitting child process has not already finished. This keeps the
 * server flag (which drives the dashboard "asking" badge) consistent with what
 * the UI actually renders, including across concurrent best-of-N children.
 */
export function recomputeHasPendingAsk(managed: ManagedOperation): void {
  const answeredIds = new Set<string>();
  // Ordered markers of asks and child completions as they appear in the stream.
  // Order matters: a completion only dismisses asks that came BEFORE it. Child
  // labels are reused across autonomous cycles (the same repo runs in Cycle 1
  // and Cycle 2), so an earlier-cycle completion must not suppress a genuine
  // pending ask emitted by the same label in a later cycle.
  type Marker =
    | { kind: "ask"; id: string; childLabel?: string }
    | { kind: "finish"; childLabel: string };
  const markers: Marker[] = [];

  for (const evt of managed.events) {
    if (evt.type === "complete" && evt.childLabel) {
      markers.push({ kind: "finish", childLabel: evt.childLabel });
    }
    try {
      const data = JSON.parse(evt.data);
      if (data.type === "result" && evt.childLabel) {
        markers.push({ kind: "finish", childLabel: evt.childLabel });
      } else if (data.type === "user") {
        for (const block of data.message?.content ?? []) {
          if (block.type === "tool_result") answeredIds.add(block.tool_use_id);
        }
      } else if (data.type === "assistant") {
        for (const block of data.message?.content ?? []) {
          if (block.type === "tool_use" && block.name === "AskUserQuestion") {
            markers.push({ kind: "ask", id: block.id, childLabel: evt.childLabel });
          }
        }
      }
    } catch {
      // ignore parse errors (non-JSON status/terminal payloads)
    }
  }

  // Walk backward; a childLabel seen finishing later in the stream marks any
  // earlier same-label ask as stale.
  const finishedAfter = new Set<string>();
  let pending = false;
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    if (m.kind === "finish") {
      finishedAfter.add(m.childLabel);
      continue;
    }
    if (!answeredIds.has(m.id) && !(m.childLabel && finishedAfter.has(m.childLabel))) {
      pending = true;
      break;
    }
  }
  managed.hasPendingAsk = pending;
}

/**
 * Emit synthetic tool_result events for any unanswered AskUserQuestion from a
 * specific childLabel. This ensures findPendingAsk() on the client won't keep
 * showing stale ask inputs after the child process has finished.
 */
function dismissPendingAsksForChild(
  managed: ManagedOperation,
  childLabel: string,
  phaseExtra?: { phaseIndex?: number; phaseLabel?: string; parentChildLabel?: string },
): void {
  const answeredIds = new Set<string>();
  const pendingAskIds: string[] = [];

  for (const evt of managed.events) {
    if (evt.childLabel !== childLabel) continue;
    try {
      const data = JSON.parse(evt.data);
      if (data.type === "user") {
        for (const block of data.message?.content ?? []) {
          if (block.type === "tool_result") answeredIds.add(block.tool_use_id);
        }
      } else if (data.type === "assistant") {
        for (const block of data.message?.content ?? []) {
          if (block.type === "tool_use" && block.name === "AskUserQuestion") {
            pendingAskIds.push(block.id);
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  for (const toolId of pendingAskIds) {
    if (answeredIds.has(toolId)) continue;
    emitEvent(managed, {
      type: "output",
      operationId: managed.operation.id,
      data: JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: toolId,
            content: "(dismissed — child process ended)",
          }],
        },
      }),
      timestamp: new Date().toISOString(),
      childLabel,
      ...(phaseExtra?.phaseIndex !== undefined && { phaseIndex: phaseExtra.phaseIndex }),
      ...(phaseExtra?.phaseLabel && { phaseLabel: phaseExtra.phaseLabel }),
      ...(phaseExtra?.parentChildLabel && { parentChildLabel: phaseExtra.parentChildLabel }),
    });
  }

  // Recompute the global flag from the full event stream. The narrow
  // "only reset when this child had an unanswered ask" check missed the case
  // where the child's ask was auto-answered (skipAskUserQuestion mode emits a
  // synthetic tool_result), leaving hasPendingAsk stuck true forever.
  recomputeHasPendingAsk(managed);
}

/**
 * Wire a child ClaudeProcess to the parent ManagedOperation.
 * Tags every event with childLabel (and optional phaseExtra) and updates child status on completion.
 */
export function wireChild(
  managed: ManagedOperation,
  childId: string,
  childLabel: string,
  process: ClaudeProcess,
  phaseExtra?: { phaseIndex?: number; phaseLabel?: string; parentChildLabel?: string },
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
    const signal = managed.abortController.signal;

    // Abort listener — cleaned up when the complete event fires
    const onAbort = () => {
      if (resolved) return;
      resolved = true;
      process.kill();
      dismissPendingAsksForChild(managed, childLabel, phaseExtra);
      const child = managed.operation.children?.find((c) => c.id === childId);
      if (child) child.status = "failed";
      managed.childProcesses.delete(childId);
      resolve({ success: false, resultText: undefined });
    };

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
        // Remove abort listener to avoid holding references after completion
        signal.removeEventListener("abort", onAbort);
        // Wrap JSON.parse in try/catch so a single malformed event
        // doesn't crash the entire operation.
        let success: boolean;
        try {
          const data = JSON.parse(event.data);
          success = data.exitCode === 0;
        } catch (err) {
          console.warn(`[wire-child] Failed to parse complete event data for ${childId}:`, err);
          success = false;
        }
        dismissPendingAsksForChild(managed, childLabel, phaseExtra);
        const child = managed.operation.children?.find((c) => c.id === childId);
        if (child) child.status = success ? "completed" : "failed";
        managed.childProcesses.delete(childId);
        resolve({ success, resultText: process.getResultText() });
      }
    });

    // If the operation is cancelled, resolve immediately as failed
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
