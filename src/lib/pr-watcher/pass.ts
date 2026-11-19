import { loadWatchState, saveWatchState } from "@/lib/db/pr-watch";
import { readRepoPullRequest } from "@/lib/workspace/pr-threads";
import { listWatchTargets, readBaseSha, readNotifications } from "./index";
import { createWatchScheduler, emptyWatchState } from "./scheduler";

/** One watcher pass from the saved schedule; returns the number of events recorded. */
export async function runWatchPass(sweepMs: number, now = Date.now()): Promise<number> {
  const state = loadWatchState() ?? emptyWatchState();
  const deps = { listTargets: listWatchTargets, read: readRepoPullRequest, notified: readNotifications, baseSha: readBaseSha };
  const recorded = await createWatchScheduler(deps, sweepMs, state).tick(now);
  saveWatchState(state);
  return recorded;
}
