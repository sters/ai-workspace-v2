#!/usr/bin/env bun
/**
 * Entry point for the background worker. Spawned by bin/start.ts. Once a
 * minute it starts the scheduled tasks that have come due: `command` tasks
 * here, `prompt` tasks through the Next server, which holds operations. It
 * registers aiw's own tasks (the PR watcher) the first time it starts.
 *
 * Required env: AIW_WORKSPACE_ROOT (set by start.ts).
 */

import path from "node:path";
import { getConfig, getConfigFilePath, loadConfigFile, setWorkspaceRoot } from "../src/lib/config";
import { ensureBuiltinScheduledTask } from "../src/lib/db/scheduled-tasks";
import { getCleanEnv } from "../src/lib/env";
import { createWorkerDeps } from "../src/lib/scheduled-tasks/client";
import { createCommandRunner } from "../src/lib/scheduled-tasks/command";
import { tickScheduledTasks } from "../src/lib/scheduled-tasks/scheduler";

const root = process.env.AIW_WORKSPACE_ROOT;
if (!root) {
  console.error("[worker] AIW_WORKSPACE_ROOT not set; refusing to start");
  process.exit(1);
}
setWorkspaceRoot(root);

const cfg = getConfig();
const TICK_MS = 60 * 1000;

// A config.yml that still has `watcher.enabled` / `watcher.intervalMinutes`
// seeds the first registration; after that the task is the only setting.
const legacy = (loadConfigFile(getConfigFilePath()) as { watcher?: { enabled?: boolean; intervalMinutes?: number } } | null)?.watcher;
ensureBuiltinScheduledTask("pr-watcher", {
  title: "PR watcher",
  request: "",
  kind: "command",
  prompt: `bun --bun run "$AIW_HOME/bin/pr-watch.ts" --sweep-minutes ${legacy?.intervalMinutes ?? 15}`,
  cron: "* * * * *",
  overlap: "skip",
  enabled: legacy?.enabled ?? true,
});

// Under `bun --hot` this file is re-evaluated in the same process; a generation
// counter lets the previous loop notice and stop instead of running twice, and
// the command runner is kept so commands still running stay counted.
const hotState = globalThis as typeof globalThis & {
  __aiwWorkerGen?: number;
  __aiwCommandRunner?: ReturnType<typeof createCommandRunner>;
};
const generation = (hotState.__aiwWorkerGen ?? 0) + 1;
hotState.__aiwWorkerGen = generation;
hotState.__aiwCommandRunner ??= createCommandRunner({
  cwd: root,
  env: getCleanEnv({ AIW_WORKSPACE_ROOT: root, AIW_HOME: path.resolve(import.meta.dir, "..") }),
});

const getDeps = createWorkerDeps(`http://localhost:${cfg.server.port}`, hotState.__aiwCommandRunner);
console.log("[worker] scheduled-tasks: checking every minute");
while (hotState.__aiwWorkerGen === generation) {
  try {
    await tickScheduledTasks(new Date(), getDeps);
  } catch (err) {
    console.error("[worker] scheduled-tasks tick failed:", err);
  }
  await Bun.sleep(TICK_MS);
}
