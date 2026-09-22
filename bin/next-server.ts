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
import {
  PREWARM_PARAM_VALUE,
  discoverPageRoutes,
  prewarmRoutes,
  resolvePrewarmPaths,
  waitForServer,
} from "../src/lib/dev/prewarm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");

const isDev = process.argv.includes("--dev");
const isHot = process.argv.includes("--hot");

// Clear .next cache in hot mode to avoid stale route issues. Only the hot
// path: `--dev` and production both serve a build, and deleting it without
// building one is how `bun run dev` came to fail on a missing production
// build. Keeping Turbopack's dev filesystem cache across restarts was
// measured and buys nothing here — a cold sweep of every page route ran
// 7.5-11.5s against 10.6-11.4s with the cache preserved.
if (isHot && existsSync(resolve(projectDir, ".next"))) {
  console.log("Clearing .next cache...");
  rmSync(resolve(projectDir, ".next"), { recursive: true, force: true });
}

// Build first if there is no production build to serve. `.next` alone does not
// say there is one: a hot run leaves its own artifacts under `.next/dev`,
// which `next start` cannot serve.
if (!isHot && !existsSync(resolve(projectDir, ".next", "BUILD_ID"))) {
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
const prewarmAbort = new AbortController();
function stop(signal: string) {
  stopSignal = signal;
  console.log(`[next-server] received ${signal}, stopping ${nextArgs.slice(2).join(" ")}`);
  prewarmAbort.abort();
  child.kill();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

/**
 * `next dev` compiles a page on its first request, so without this the human
 * pays that compile on every page they open first. Sweep them all in the
 * background instead — by the time the first click lands, most are already
 * built, and an already-compiled page answers in ~30ms.
 */
async function prewarmPages() {
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (url: string) => fetch(url, { signal: prewarmAbort.signal });

  // The root page is the first thing compiled either way, so the readiness
  // probe is also the first item of the sweep.
  const ready = await waitForServer(`${baseUrl}/`, {
    fetch: request,
    sleep: (ms) => Bun.sleep(ms),
    signal: prewarmAbort.signal,
  });
  if (!ready) return;

  const routes = discoverPageRoutes(resolve(projectDir, "src", "app"));
  const paths = resolvePrewarmPaths(routes, {
    name: PREWARM_PARAM_VALUE,
    timestamp: PREWARM_PARAM_VALUE,
  });
  if (paths.length === 0) return;

  const startedAt = Date.now();
  const { ok, failed } = await prewarmRoutes(baseUrl, paths, {
    fetch: request,
    signal: prewarmAbort.signal,
  });
  if (prewarmAbort.signal.aborted) return;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[next-server] pre-compiled ${ok}/${paths.length} page routes in ${elapsed}s` +
      (failed > 0 ? ` (${failed} failed)` : ""),
  );
}

if (isHot) {
  void prewarmPages();
  void child.exited.then(() => prewarmAbort.abort());
}
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
