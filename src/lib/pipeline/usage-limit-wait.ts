import type { ClaudeProcess } from "@/types/claude";
import type { ManagedOperation, WireChildResult } from "./types";
import { emitStatus } from "./events";
import { delay } from "./phase-helpers";
import { wireChild } from "./wire-child";
import { getConfig } from "@/lib/config";
import { sendUsageLimitNotification } from "@/lib/web-push";

/** `resetsAt` has second precision and the server's clock is not ours. */
const RESET_MARGIN_MS = 60_000;
/** Covers the five-hour session window; a weekly reset fails the child as before. */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
/** A limit that is still rejecting after this many resets is not going to clear by waiting. */
const MAX_WAITS = 3;

/**
 * Run a Claude child through `wireChild`; when it fails on an exhausted usage
 * allowance and `operations.waitOutUsageLimit` is on, wait until the allowance
 * resets and run it again from the same prompt. The wait is held as a pause on
 * `managed` so the phase timeout does not count it (see `usageLimitPausedMs`).
 */
export async function runChildWaitingOutUsageLimit(
  managed: ManagedOperation,
  childId: string,
  childLabel: string,
  spawn: () => ClaudeProcess,
  phaseExtra?: { phaseIndex?: number; phaseLabel?: string; parentChildLabel?: string },
): Promise<WireChildResult> {
  const signal = managed.abortController.signal;
  for (let waits = 0; ; waits++) {
    const result = await wireChild(managed, childId, childLabel, spawn(), phaseExtra);
    if (result.success || result.usageLimitResetsAt === undefined || signal.aborted) return result;
    if (!getConfig().operations.waitOutUsageLimit) return result;

    const waitMs = Math.max(0, result.usageLimitResetsAt - Date.now()) + RESET_MARGIN_MS;
    const resumeAtMs = Date.now() + waitMs;
    const resumeAt = new Date(resumeAtMs).toLocaleString();
    if (waits >= MAX_WAITS || waitMs > MAX_WAIT_MS) {
      emitStatus(managed, `Usage limit reached — not waiting for the reset at ${resumeAt}`, { childLabel, ...phaseExtra });
      return result;
    }

    emitStatus(managed, `Usage limit reached — waiting until ${resumeAt} to retry`, { childLabel, ...phaseExtra });
    const operation = managed.operation;
    if (beginPause(managed, resumeAtMs)) sendUsageLimitNotification(operation.id, operation.workspace, resumeAtMs);
    let resumed: boolean;
    try {
      await delay(waitMs, signal);
    } finally {
      resumed = endPause(managed);
    }
    if (signal.aborted) return result;
    if (resumed) sendUsageLimitNotification(operation.id, operation.workspace, null);

    const child = managed.operation.children?.find((c) => c.id === childId);
    if (child) child.status = "running";
  }
}

/**
 * Total time any child of the operation has spent waiting out a usage limit,
 * including a wait still in progress. Overlapping waits count once.
 */
export function usageLimitPausedMs(managed: ManagedOperation): number {
  const pause = managed.usageLimitPause;
  if (!pause) return 0;
  return pause.totalMs + (pause.active > 0 ? Date.now() - pause.since : 0);
}

/** When the operation's waits on a usage limit end, or undefined when nothing is waiting. */
export function usageLimitWaitUntil(managed: ManagedOperation): number | undefined {
  const pause = managed.usageLimitPause;
  return pause && pause.active > 0 ? pause.until : undefined;
}

/** Returns true when this starts the operation's wait (nothing else was waiting). */
function beginPause(managed: ManagedOperation, untilMs: number): boolean {
  const pause = (managed.usageLimitPause ??= { active: 0, since: 0, totalMs: 0, until: 0 });
  const started = pause.active++ === 0;
  if (started) pause.since = Date.now();
  pause.until = Math.max(pause.until, untilMs);
  return started;
}

/** Returns true when this ends the operation's wait (nothing else is still waiting). */
function endPause(managed: ManagedOperation): boolean {
  const pause = managed.usageLimitPause;
  if (!pause || pause.active === 0) return false;
  if (--pause.active > 0) return false;
  pause.totalMs += Date.now() - pause.since;
  pause.until = 0;
  return true;
}
