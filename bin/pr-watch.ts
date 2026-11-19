#!/usr/bin/env bun
/**
 * One PR watcher pass, run every minute by the built-in "PR watcher" scheduled
 * task. `--sweep-minutes N` (default 15) is how often every PR is read; in
 * between, only PRs a signal names are read (src/lib/pr-watcher/scheduler.ts).
 *
 * Required env: AIW_WORKSPACE_ROOT (set by the worker).
 */

import { parseArgs } from "node:util";
import { setWorkspaceRoot } from "../src/lib/config";
import { runWatchPass } from "../src/lib/pr-watcher/pass";

const root = process.env.AIW_WORKSPACE_ROOT;
if (!root) {
  console.error("[pr-watch] AIW_WORKSPACE_ROOT not set");
  process.exit(1);
}
setWorkspaceRoot(root);

const { values } = parseArgs({ options: { "sweep-minutes": { type: "string", default: "15" } } });
const sweepMinutes = Number(values["sweep-minutes"]);
if (!Number.isFinite(sweepMinutes) || sweepMinutes < 1) {
  console.error(`[pr-watch] --sweep-minutes must be a number of at least 1, got "${values["sweep-minutes"]}"`);
  process.exit(1);
}

const recorded = await runWatchPass(sweepMinutes * 60_000);
console.log(`${recorded} event(s)`);
