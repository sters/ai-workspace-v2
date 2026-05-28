import type { OperationEvent } from "@/types/operation";
import { operations } from "./store";
import { emitEvent } from "./events";
import { getOperation, updateOperationStatus } from "@/lib/db";

export function killOperation(id: string): boolean {
  const managed = operations.get(id);
  if (managed) {
    if (managed.operation.status !== "running") return false;
    managed.abortController.abort();
    // kill() sends SIGTERM. The ClaudeProcess.kill() in cli.ts already
    // includes its own SIGKILL fallback for the internal subprocess.
    if (managed.claudeProcess) managed.claudeProcess.kill();
    for (const [, entry] of managed.childProcesses) {
      entry.process.kill(); // SIGTERM (with SIGKILL fallback inside ClaudeProcess.kill)
    }
    return true;
  }
  // Fallback: row is "running" in DB but absent from the in-memory store —
  // typically a stale operation from a previous server session that resume
  // never picked back up (e.g. resume crashed, or the user clicked Cancel
  // before resumeStaleOperations() reached it). Mark it failed directly so
  // the stuck row clears and resume won't try to revive it on next restart.
  const row = getOperation(id);
  if (!row || row.status !== "running") return false;
  updateOperationStatus(id, "failed", new Date().toISOString());
  return true;
}

/**
 * Resolves when the given operation is no longer in the "running" state.
 * Uses both listener subscription and a polling fallback because markComplete
 * clears managed.listeners after firing the complete event — if a caller
 * subscribes after that clear, it would otherwise never see the transition.
 * Hard cap at 60 s so callers never hang on a leaked op.
 */
export function whenOperationFinished(id: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const managed = operations.get(id);
    if (!managed || managed.operation.status !== "running") {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      managed.listeners.delete(listener);
      clearInterval(poller);
      clearTimeout(hardCap);
      resolve();
    };

    const listener = (event: OperationEvent) => {
      if (event.type === "complete") finish();
    };
    managed.listeners.add(listener);

    const poller = setInterval(() => {
      const m = operations.get(id);
      if (!m || m.operation.status !== "running") finish();
    }, 250);

    const hardCap = setTimeout(finish, 60_000);
  });
}

export function submitAnswer(
  id: string,
  toolUseId: string,
  answers: Record<string, string>,
): boolean {
  const managed = operations.get(id);
  if (!managed) return false;
  if (managed.operation.status !== "running") {
    // Operation finished — ask is moot, clear the stale flag and inject
    // a synthetic tool_result so it doesn't reappear after reload.
    managed.hasPendingAsk = false;
    emitEvent(managed, {
      type: "output",
      operationId: managed.operation.id,
      data: JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: toolUseId,
            content: "(dismissed — operation no longer running)",
          }],
        },
      }),
      timestamp: new Date().toISOString(),
    });
    return false;
  }
  // Check function-phase pending asks first
  const pendingResolver = managed.pendingAsks.get(toolUseId);
  if (pendingResolver) {
    managed.pendingAsks.delete(toolUseId);
    managed.hasPendingAsk = false;
    pendingResolver(answers);
    return true;
  }
  if (managed.claudeProcess?.submitAnswer(toolUseId, answers)) {
    managed.hasPendingAsk = false;
    return true;
  }
  for (const [, entry] of managed.childProcesses) {
    if (entry.process.submitAnswer(toolUseId, answers)) {
      managed.hasPendingAsk = false;
      // Emit a synthetic tool_result so findPendingAsk() in the UI
      // immediately stops showing the ask input (before the resumed
      // process sends the real tool_result).
      emitEvent(managed, {
        type: "output",
        operationId: managed.operation.id,
        data: JSON.stringify({
          type: "user",
          message: {
            content: [{
              type: "tool_result",
              tool_use_id: toolUseId,
              content: Object.entries(answers).map(([q, a]) => `**${q}**\n${a}`).join("\n\n"),
            }],
          },
        }),
        timestamp: new Date().toISOString(),
        ...(entry.childLabel && { childLabel: entry.childLabel }),
        ...(entry.phaseIndex !== undefined && { phaseIndex: entry.phaseIndex }),
        ...(entry.phaseLabel && { phaseLabel: entry.phaseLabel }),
      });
      return true;
    }
  }
  // Ask not found in any process — it's stale (e.g. the child process
  // that emitted it has already finished). Emit a synthetic tool_result
  // so findPendingAsk() won't show it again, even after page reload.
  managed.hasPendingAsk = false;
  emitEvent(managed, {
    type: "output",
    operationId: managed.operation.id,
    data: JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: "(dismissed — process no longer accepting answers)",
        }],
      },
    }),
    timestamp: new Date().toISOString(),
  });
  return false;
}
