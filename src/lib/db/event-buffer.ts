import type { OperationEvent } from "@/types/operation";
import { appendEvents } from "./events";

const FLUSH_INTERVAL_MS = 500;
const FLUSH_THRESHOLD = 50;

interface BufferEntry {
  events: OperationEvent[];
  timer: ReturnType<typeof setTimeout> | null;
}

const buffers = new Map<string, BufferEntry>();

function getOrCreateBuffer(operationId: string): BufferEntry {
  let entry = buffers.get(operationId);
  if (!entry) {
    entry = { events: [], timer: null };
    buffers.set(operationId, entry);
  }
  return entry;
}

/**
 * Add an event to the buffer for a given operation.
 * If the buffer reaches FLUSH_THRESHOLD, it flushes immediately.
 */
export function bufferEvent(operationId: string, event: OperationEvent): void {
  const entry = getOrCreateBuffer(operationId);
  entry.events.push(event);

  if (entry.events.length >= FLUSH_THRESHOLD) {
    flushEvents(operationId);
  }
}

/**
 * Flush buffered events for an operation to SQLite.
 */
export function flushEvents(operationId: string): void {
  const entry = buffers.get(operationId);
  if (!entry || entry.events.length === 0) return;

  const eventsToFlush = entry.events.splice(0);
  try {
    appendEvents(eventsToFlush);
  } catch (err) {
    console.warn(`[event-buffer] Failed to flush events for ${operationId}:`, err);
    // Put events back at the front so they aren't lost
    entry.events.unshift(...eventsToFlush);
  }
}

/**
 * Start periodic auto-flush for an operation (500ms interval).
 */
export function startAutoFlush(operationId: string): void {
  const entry = getOrCreateBuffer(operationId);
  if (entry.timer) return; // already running

  const tick = () => {
    flushEvents(operationId);
    const current = buffers.get(operationId);
    if (current?.timer) {
      current.timer = setTimeout(tick, FLUSH_INTERVAL_MS);
    }
  };

  entry.timer = setTimeout(tick, FLUSH_INTERVAL_MS);
}

/**
 * Stop auto-flush and perform a final flush.
 * Call this when an operation completes.
 */
export function stopAutoFlush(operationId: string): void {
  const entry = buffers.get(operationId);
  if (!entry) return;

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  // Final flush
  flushEvents(operationId);
  buffers.delete(operationId);
}
