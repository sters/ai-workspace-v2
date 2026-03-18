/**
 * Shared utility for parsing __phaseUpdate events from operation event streams.
 * Used by both OperationCard (raw events) and OperationLog (parsed entries).
 */

import type { OperationPhaseInfo, OperationEvent } from "@/types/operation";
import type { LogEntry } from "@/types/claude";

/**
 * Parse phase updates from raw OperationEvents (for OperationCard).
 */
export function parsePhaseUpdatesFromEvents(
  events: OperationEvent[],
): OperationPhaseInfo[] | undefined {
  const phaseMap = new Map<number, OperationPhaseInfo>();
  for (const event of events) {
    if (event.type === "status" && event.data.startsWith("__phaseUpdate:")) {
      parseAndUpsert(phaseMap, event.data.slice("__phaseUpdate:".length));
    }
  }
  if (phaseMap.size === 0) return undefined;
  return Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
}

/**
 * Parse phase updates from parsed LogEntries (for OperationLog).
 */
export function parsePhaseUpdatesFromEntries(
  entries: LogEntry[],
): OperationPhaseInfo[] | undefined {
  const phaseMap = new Map<number, OperationPhaseInfo>();
  for (const entry of entries) {
    if (entry.kind === "system" && entry.content.startsWith("__phaseUpdate:")) {
      parseAndUpsert(phaseMap, entry.content.slice("__phaseUpdate:".length));
    }
  }
  if (phaseMap.size === 0) return undefined;
  return Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
}

function parseAndUpsert(
  phaseMap: Map<number, OperationPhaseInfo>,
  jsonStr: string,
): void {
  try {
    const data = JSON.parse(jsonStr);
    const idx = data.phaseIndex as number;
    const existing = phaseMap.get(idx);
    if (existing) {
      existing.status = data.phaseStatus;
    } else {
      phaseMap.set(idx, {
        index: idx,
        label: data.phaseLabel ?? `Phase ${idx + 1}`,
        status: data.phaseStatus,
      });
    }
  } catch {
    // ignore parse errors
  }
}
