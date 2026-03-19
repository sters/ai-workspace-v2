import type { OperationEvent } from "@/types/operation";
import type { ManagedOperation } from "./types";
import { sendAskNotification } from "@/lib/web-push";

export function emitEvent(managed: ManagedOperation, event: OperationEvent) {
  managed.events.push(event);
  if (managed.events.length > 5000) {
    managed.events = managed.events.slice(-3000);
  }

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

  // Emit the complete event BEFORE clearing listeners so SSE clients receive it
  emitEvent(managed, {
    type: "complete",
    operationId: managed.operation.id,
    data: JSON.stringify({ exitCode: success ? 0 : 1 }),
    timestamp: new Date().toISOString(),
  });

  // Persist to disk, then release events from memory
  const eventsSnapshot = managed.events.slice();
  const operationSnapshot = { ...managed.operation };
  import("../operation-store")
    .then(({ writeOperationLog }) => {
      writeOperationLog(operationSnapshot, eventsSnapshot);
      // Events are now on disk — free them from memory
      managed.events.length = 0;
    })
    .catch((err) => console.warn("[pipeline-manager] Failed to persist operation log:", err));

  // Release references to help GC
  managed.childProcesses.clear();
  managed.pendingAsks.clear();
  managed.listeners.clear();
  managed.claudeProcess = null;
}
