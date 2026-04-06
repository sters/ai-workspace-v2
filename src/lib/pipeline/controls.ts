import { operations } from "./store";
import { emitEvent } from "./events";

export function killOperation(id: string): boolean {
  const managed = operations.get(id);
  if (!managed || managed.operation.status !== "running") return false;
  managed.abortController.abort();
  // kill() sends SIGTERM. The ClaudeProcess.kill() in cli.ts already
  // includes its own SIGKILL fallback for the internal subprocess.
  if (managed.claudeProcess) managed.claudeProcess.kill();
  for (const [, entry] of managed.childProcesses) {
    entry.process.kill(); // SIGTERM (with SIGKILL fallback inside ClaudeProcess.kill)
  }
  return true;
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
