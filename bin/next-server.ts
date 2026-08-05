/**
 * Entry point to start the Next.js server.
 * Usage: bun run bin/next-server.ts [--dev] [--hot]
 *
 * Runs `next dev` (with --hot), `next start` (default) on port 3741.
 * With --dev, builds first if needed then runs `next start`.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describeChildExit } from "../src/lib/process/child-exit";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");

const isDev = process.argv.includes("--dev");
const isHot = process.argv.includes("--hot");

// Clear .next cache in dev modes to avoid stale route issues
if ((isDev || isHot) && existsSync(resolve(projectDir, ".next"))) {
  console.log("Clearing .next cache...");
  rmSync(resolve(projectDir, ".next"), { recursive: true, force: true });
}

// For production mode, build first if needed
if (!isDev && !isHot && !existsSync(resolve(projectDir, ".next"))) {
  console.log("Building...");
  Bun.spawnSync(["bun", "--bun", "next", "build"], {
    cwd: projectDir,
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
  });
}

const port = process.env.AIW_PORT || "3741";

const nextArgs = isHot
  ? ["bun", "--bun", "next", "dev", "-p", port]
  : ["bun", "--bun", "next", "start", "-p", port];

const child = Bun.spawn(nextArgs, {
  cwd: projectDir,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, PORT: port, AIW_PORT: port },
});

let shutdownRequested = false;
function stop(signal: string) {
  shutdownRequested = true;
  console.log(`[next-server] received ${signal}, stopping ${nextArgs.slice(2).join(" ")}`);
  child.kill();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
await child.exited;
console.log(
  `[next-server] ${describeChildExit({
    name: nextArgs.slice(2).join(" "),
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    requested: shutdownRequested,
  })}`,
);
process.exit(child.exitCode ?? 0);
