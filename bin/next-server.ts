/**
 * Entry point to start the Next.js server.
 * Usage: bun run bin/next-server.ts [--dev] [--hot]
 *
 * Runs `next dev` (with --hot), `next start` (default) on port 3741.
 * With --dev, builds first if needed then runs `next start`.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");

const isDev = process.argv.includes("--dev");
const isHot = process.argv.includes("--hot");

// For production mode, build first if needed
if (!isDev && !isHot && !existsSync(resolve(projectDir, ".next"))) {
  console.log("Building...");
  Bun.spawnSync(["bun", "--bun", "next", "build"], {
    cwd: projectDir,
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });
}

const nextArgs = isHot
  ? ["bun", "--bun", "next", "dev", "-p", "3741"]
  : ["bun", "--bun", "next", "start", "-p", "3741"];

const child = Bun.spawn(nextArgs, {
  cwd: projectDir,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, PORT: "3741" },
});

process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
await child.exited;
process.exit(child.exitCode ?? 0);
