#!/usr/bin/env bun
/**
 * Entry point for the background worker. Spawned by bin/start.ts. Each job
 * ticks once a minute in its own loop, so a slow one does not delay the rest:
 * - PR watcher (unless `watcher.enabled: false`)
 * - scheduled tasks, started through the Next server, which holds operations
 *
 * Required env: AIW_WORKSPACE_ROOT (set by start.ts).
 */

import { setWorkspaceRoot, getConfig } from "../src/lib/config";
import { recordWorkerJobFinish, recordWorkerJobStart } from "../src/lib/db/worker-jobs";
import { listWatchTargets, readBaseSha, readNotifications } from "../src/lib/pr-watcher";
import { createWatchScheduler } from "../src/lib/pr-watcher/scheduler";
import { createServerDeps } from "../src/lib/scheduled-tasks/client";
import { tickScheduledTasks } from "../src/lib/scheduled-tasks/scheduler";
import { WORKER_JOBS } from "../src/lib/worker-jobs";
import { readRepoPullRequest } from "../src/lib/workspace/pr-threads";

const root = process.env.AIW_WORKSPACE_ROOT;
if (!root) {
  console.error("[worker] AIW_WORKSPACE_ROOT not set; refusing to start");
  process.exit(1);
}
setWorkspaceRoot(root);

const cfg = getConfig();
const TICK_MS = 60 * 1000;

// Under `bun --hot` this file is re-evaluated in the same process; a generation
// counter lets the previous loops notice and stop instead of running twice.
const hotState = globalThis as typeof globalThis & { __aiwWorkerGen?: number };
const generation = (hotState.__aiwWorkerGen ?? 0) + 1;
hotState.__aiwWorkerGen = generation;

/** Runs `tick` every minute, recording each tick for the Scheduled Tasks page's built-in list. */
async function loop(name: string, tick: () => Promise<void>) {
  while (hotState.__aiwWorkerGen === generation) {
    recordWorkerJobStart(name, new Date().toISOString());
    let error: string | null = null;
    try {
      await tick();
    } catch (err) {
      console.error(`[worker] ${name} failed:`, err);
      error = err instanceof Error ? err.message : String(err);
    }
    recordWorkerJobFinish(name, new Date().toISOString(), error);
    await Bun.sleep(TICK_MS);
  }
}

if (cfg.watcher.enabled) {
  const sweepMs = Math.max(1, cfg.watcher.intervalMinutes) * 60 * 1000;
  const watch = createWatchScheduler(
    { listTargets: listWatchTargets, read: readRepoPullRequest, notified: readNotifications, baseSha: readBaseSha },
    sweepMs,
  );
  console.log(`[worker] pr-watcher: checking signals every minute, sweeping every ${sweepMs / 60000} min`);
  void loop(WORKER_JOBS.PR_WATCHER, async () => {
    const n = await watch.tick(Date.now());
    if (n > 0) console.log(`[worker] pr-watcher: ${n} event(s)`);
  });
} else {
  console.log("[worker] pr-watcher disabled in config");
}

const serverUrl = `http://localhost:${cfg.server.port}`;
console.log("[worker] scheduled-tasks: checking every minute");
void loop(WORKER_JOBS.SCHEDULED_TASKS, async () => {
  await tickScheduledTasks(new Date(), await createServerDeps(serverUrl));
});
