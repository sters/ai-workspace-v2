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
import { describeChildExit, reraiseSignal, signalExitCode } from "../src/lib/process/child-exit";

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

let stopSignal: string | null = null;
function stop(signal: string) {
  stopSignal = signal;
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
    requested: stopSignal !== null,
  })}`,
);

// Pass the signal on rather than exiting cleanly: bin/start.ts decides whether
// the whole tree is coming down by inspecting how we died, and a graceful `0`
// here reads as a voluntary shutdown no matter who killed us. `pkill -f
// "next dev"` from an unrelated project is enough to reach this path.
if (stopSignal) {
  if (reraiseSignal(stopSignal)) await Bun.sleep(100); // let the signal land
  process.exit(signalExitCode(stopSignal));
}
process.exit(child.exitCode ?? 0);
