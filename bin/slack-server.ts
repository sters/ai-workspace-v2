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
import { startSlackServer } from "../src/lib/slack-server";

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

const running = await startSlackServer({
  botToken: cfg.slack.botToken,
  appToken: cfg.slack.appToken,
  allowedUserIds: new Set(cfg.slack.allowedUserIds),
  apiBaseUrl: `http://localhost:${cfg.server.port}`,
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[slack-server] received ${signal}, stopping…`);
  try {
    await running.stop();
  } catch (err) {
    console.error("[slack-server] error during stop:", err);
  }
  process.exit(0);
}

process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
