#!/usr/bin/env bun
/**
 * Entry point for the PR watcher process. Spawned by bin/start.ts when
 * `watcher.enabled` is true.
 *
 * Required env: AIW_WORKSPACE_ROOT (set by start.ts).
 */

import { setWorkspaceRoot, getConfig } from "../src/lib/config";
import { listWatchTargets, readBaseSha, readNotifications } from "../src/lib/pr-watcher";
import { createWatchScheduler } from "../src/lib/pr-watcher/scheduler";
import { readRepoPullRequest } from "../src/lib/workspace/pr-threads";

const root = process.env.AIW_WORKSPACE_ROOT;
if (!root) {
  console.error("[pr-watcher] AIW_WORKSPACE_ROOT not set; refusing to start");
  process.exit(1);
}
setWorkspaceRoot(root);

const cfg = getConfig();
if (!cfg.watcher.enabled) {
  console.log("[pr-watcher] disabled in config; exiting");
  process.exit(0);
}

const sweepMs = Math.max(1, cfg.watcher.intervalMinutes) * 60 * 1000;
const TICK_MS = 60 * 1000;
const scheduler = createWatchScheduler(
  { listTargets: listWatchTargets, read: readRepoPullRequest, notified: readNotifications, baseSha: readBaseSha },
  sweepMs,
);

// Under `bun --hot` this file is re-evaluated in the same process; a generation
// counter lets the previous loop notice and stop instead of polling twice.
const hotState = globalThis as typeof globalThis & { __aiwPrWatcherGen?: number };
const generation = (hotState.__aiwPrWatcherGen ?? 0) + 1;
hotState.__aiwPrWatcherGen = generation;

console.log(`[pr-watcher] checking signals every minute, sweeping every ${sweepMs / 60000} min`);
while (hotState.__aiwPrWatcherGen === generation) {
  try {
    const n = await scheduler.tick(Date.now());
    if (n > 0) console.log(`[pr-watcher] ${n} event(s)`);
  } catch (err) {
    console.error("[pr-watcher] cycle failed:", err);
  }
  await Bun.sleep(TICK_MS);
}
