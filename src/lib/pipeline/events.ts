import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation } from "./types";
import { sendAskNotification, sendCompletionNotification } from "@/lib/web-push";
import { bufferEvent, stopAutoFlush } from "@/lib/db";
import { extractResultSummary } from "@/lib/parsers/stream";

export function emitEvent(managed: ManagedOperation, event: OperationEvent) {
  managed.events.push(event);
  if (managed.events.length > 5000) {
    managed.events = managed.events.slice(-3000);
  }

  // Buffer event for periodic SQLite flush
  bufferEvent(managed.operation.id, event);

  // Detect AskUserQuestion events to track pending ask state
  if (event.type === "output" && event.data.includes('"AskUserQuestion"')) {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === "assistant" && Array.isArray(parsed.message?.content)) {
        for (const block of parsed.message.content) {
          if (block.type === "tool_use" && block.name === "AskUserQuestion") {
            managed.hasPendingAsk = true;
            sendAskNotification(managed.operation.id, managed.operation.workspace ?? undefined);
            break;
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  for (const listener of managed.listeners) {
    listener(event);
  }
}

export function emitStatus(
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

export function markComplete(managed: ManagedOperation, success: boolean) {
  if (managed.operation.status !== "running") return;
  managed.operation.status = success ? "completed" : "failed";
  managed.operation.completedAt = new Date().toISOString();
  managed.completedAt = Date.now();

  sendCompletionNotification(managed.operation.id, success, managed.operation.workspace ?? undefined);

  // Emit the complete event BEFORE clearing listeners so SSE clients receive it
  emitEvent(managed, {
    type: "complete",
    operationId: managed.operation.id,
    data: JSON.stringify({ exitCode: success ? 0 : 1 }),
    timestamp: new Date().toISOString(),
  });

  // Stop auto-flush and do final flush of buffered events
  stopAutoFlush(managed.operation.id);

  // The listing renders a completed operation's result without the card being
  // expanded, and this managed entry is what it reads until GC drops it. The
  // events it comes from are cleared below, so it is extracted here — and the
  // row is written from this same value, so memory and disk cannot disagree.
  managed.resultSummary = extractResultSummary(managed.events);
  const operationSnapshot = { ...managed.operation };
  const summarySnapshot = managed.resultSummary;
  // Clear events synchronously to avoid a data loss window. Late-connecting
  // SSE clients will query events from SQLite via getOperationEvents.
  managed.events.length = 0;
  // Persist operation metadata (status, completedAt, resultSummary) to SQLite.
  // Events are already flushed above, so this only updates the operation row.
  import("../operation-store")
    .then(({ writeOperationLog }) => {
      writeOperationLog(operationSnapshot, summarySnapshot);
    })
    .catch((err) => console.warn("[pipeline-manager] Failed to persist operation log:", err));

  // Release references to help GC
  managed.childProcesses.clear();
  managed.pendingAsks.clear();
  managed.listeners.clear();
  managed.claudeProcess = null;
}
