#!/usr/bin/env bun
/**
 * Entry point for the Slack bot process. Spawned by bin/start.ts when
 * `slack.enabled` is true and tokens are present after env substitution.
 *
 * Usage: bun run bin/slack-server.ts
 *
 * Required env: AIW_WORKSPACE_ROOT (set by start.ts).
 */

import { setWorkspaceRoot, getConfig } from "../src/lib/config";
import { startSlackServer, type RunningSlackServer } from "../src/lib/slack-server";
import { ensureSlackMemoryDb } from "../src/lib/slack-server/memory-db";

const root = process.env.AIW_WORKSPACE_ROOT;
if (!root) {
  console.error("[slack-server] AIW_WORKSPACE_ROOT not set; refusing to start");
  process.exit(1);
}
setWorkspaceRoot(root);

const cfg = getConfig();
if (!cfg.slack.enabled) {
  console.log("[slack-server] disabled in config; exiting");
  process.exit(0);
}
if (!cfg.slack.botToken || !cfg.slack.appToken) {
  console.error(
    "[slack-server] botToken or appToken is empty after env substitution; exiting (set AIW_SLACK_BOT_TOKEN / AIW_SLACK_APP_TOKEN or fill in config.yml)",
  );
  process.exit(0);
}

if (cfg.slack.memoryEnabled) {
  const memPath = ensureSlackMemoryDb(root);
  console.log(`[slack-server] per-user conversation memory enabled at ${memPath}`);
}

// Under `bun --hot` this file is re-evaluated in the same process, so the
// previous Bolt app has to go before a new one connects: two Socket Mode
// connections on one app token both answer every mention. The handle is stored
// as the *promise* and stored before it is awaited, so a second reload landing
// mid-startup still finds something to stop. A stop that fails exits instead of
// opening a second connection — a bot that is down is visible, where one that
// replies twice reaches the channel.
const hotState = globalThis as typeof globalThis & {
  __aiwSlackRunning?: Promise<RunningSlackServer>;
  __aiwSlackSignalsBound?: boolean;
};
if (hotState.__aiwSlackRunning) {
  console.log("[slack-server] reload: stopping the previous Socket Mode connection…");
  try {
    await (await hotState.__aiwSlackRunning).stop();
  } catch (err) {
    console.error(
      "[slack-server] could not stop the previous connection; exiting rather than opening a second one:",
      err,
    );
    process.exit(1);
  }
}

const starting = startSlackServer({
  botToken: cfg.slack.botToken,
  appToken: cfg.slack.appToken,
  allowedUserIds: new Set(cfg.slack.allowedUserIds),
  apiBaseUrl: `http://localhost:${cfg.server.port}`,
});
hotState.__aiwSlackRunning = starting;
await starting;

let stopping = false;
// Reads the handle back out of `hotState` rather than closing over this
// evaluation's, since the handler is bound once and a reload replaces the app.
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[slack-server] received ${signal}, stopping…`);
  try {
    const current = await hotState.__aiwSlackRunning;
    await current?.stop();
  } catch (err) {
    console.error("[slack-server] error during stop:", err);
  }
  process.exit(0);
}

if (!hotState.__aiwSlackSignalsBound) {
  hotState.__aiwSlackSignalsBound = true;
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
}
